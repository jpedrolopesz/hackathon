import 'server-only';
import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import { AnswerQuestionUseCase } from '@/application/use-cases/answer-question';
import { ClosePollUseCase } from '@/application/use-cases/close-poll';
import { CreatePollUseCase } from '@/application/use-cases/create-poll';
import { DeleteChatMessageUseCase } from '@/application/use-cases/delete-chat-message';
import { HighlightQuestionUseCase } from '@/application/use-cases/highlight-question';
import { ResumeLiveSyncUseCase } from '@/application/use-cases/resume-live-sync';
import { SendChatMessageUseCase } from '@/application/use-cases/send-chat-message';
import { SendQuestionUseCase } from '@/application/use-cases/send-question';
import { SendReactionUseCase } from '@/application/use-cases/send-reaction';
import { VoteInPollUseCase } from '@/application/use-cases/vote-in-poll';
import { DomainError } from '@/domain/errors/DomainError';
import { ValidationError } from '@/domain/errors/ValidationError';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';
import { ApiGatewayRealtimeBroadcaster } from '@/infrastructure/aws/api-gateway/realtime-broadcaster';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { DynamoDbChatMessageRepository } from '@/infrastructure/repositories/dynamodb-chat-message-repository';
import { DynamoDbPollRepository } from '@/infrastructure/repositories/dynamodb-poll-repository';
import { DynamoDbQuestionRepository } from '@/infrastructure/repositories/dynamodb-question-repository';
import { DynamoDbWebSocketConnectionRepository } from '@/infrastructure/repositories/dynamodb-websocket-connection-repository';
import { DynamoDbRateLimiter } from '@/infrastructure/rate-limiting/dynamodb-rate-limiter';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não definida.`);
  }
  return value;
}

const tableName = requiredEnv('DYNAMODB_TABLE_NAME');
const chatShardCount = Number(requiredEnv('CHAT_SHARD_COUNT'));
const documentClient = getDocumentClient();

const connectionRepository = new DynamoDbWebSocketConnectionRepository(documentClient, tableName);
const chatMessageRepository = new DynamoDbChatMessageRepository(
  documentClient,
  tableName,
  chatShardCount,
);
const questionRepository = new DynamoDbQuestionRepository(documentClient, tableName);
const pollRepository = new DynamoDbPollRepository(documentClient, tableName);
const rateLimiter = new DynamoDbRateLimiter(documentClient, tableName);
const broadcaster = new ApiGatewayRealtimeBroadcaster(requiredEnv('WEBSOCKET_API_ENDPOINT'));

const sendChatMessage = new SendChatMessageUseCase(
  chatMessageRepository,
  rateLimiter,
  connectionRepository,
  broadcaster,
  chatShardCount,
);
const deleteChatMessage = new DeleteChatMessageUseCase(
  chatMessageRepository,
  connectionRepository,
  broadcaster,
);
const sendReaction = new SendReactionUseCase(connectionRepository, broadcaster);
const sendQuestion = new SendQuestionUseCase(
  questionRepository,
  rateLimiter,
  connectionRepository,
  broadcaster,
);
const answerQuestion = new AnswerQuestionUseCase(
  questionRepository,
  connectionRepository,
  broadcaster,
);
const highlightQuestion = new HighlightQuestionUseCase(
  questionRepository,
  connectionRepository,
  broadcaster,
);
const createPoll = new CreatePollUseCase(pollRepository, connectionRepository, broadcaster);
const voteInPoll = new VoteInPollUseCase(
  pollRepository,
  rateLimiter,
  connectionRepository,
  broadcaster,
);
const closePoll = new ClosePollUseCase(pollRepository, connectionRepository, broadcaster);
const resumeLiveSync = new ResumeLiveSyncUseCase(
  chatMessageRepository,
  questionRepository,
  pollRepository,
);

function asRecord(body: string | undefined): Record<string, unknown> {
  if (!body) {
    throw new ValidationError('Corpo da mensagem vazio.', 'EMPTY_BODY');
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new ValidationError('Corpo da mensagem inválido.', 'INVALID_BODY');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError('Corpo da mensagem não é um JSON válido.', 'INVALID_BODY');
  }
}

function stringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string') {
    throw new ValidationError(`Campo "${field}" é obrigatório.`, 'FIELD_REQUIRED');
  }
  return value;
}

function stringArrayField(payload: Record<string, unknown>, field: string): readonly string[] {
  const value = payload[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ValidationError(`Campo "${field}" deve ser uma lista de textos.`, 'FIELD_REQUIRED');
  }
  return value as string[];
}

/**
 * Todas as rotas nomeadas da seção 8 do README apontam para este mesmo handler (ver
 * `infrastructure/stacks/api-stack.ts`) — `event.requestContext.routeKey` diz qual
 * ação foi invocada. Rotas fora do escopo desta fase (`live.join`, `live.leave`,
 * `participant.*`) respondem com um erro explícito em vez de serem ignoradas em
 * silêncio — nenhuma delas está entre os seis pontos pedidos para a Fase 6.
 *
 * `ping`/`sync.resume` respondem só à conexão que chamou, nunca em broadcast — por
 * isso `connectionId` chega aqui, ao contrário das demais ações (que só dependem da
 * live, resolvida via `connection`).
 */
async function dispatch(
  routeKey: string,
  connectionId: string,
  connection: LiveConnectionContext,
  payload: Record<string, unknown>,
): Promise<void> {
  switch (routeKey) {
    case 'ping':
      // Heartbeat de aplicação: WebSocket API Gateway fecha conexões ociosas após
      // 10min, fixo, e não expõe frames de ping/pong nativos (docs/fase-1-
      // arquitetura.md, seção 10.8) — qualquer tráfego reseta o timer, então só
      // responder já cumpre o papel; o `pong` também deixa o cliente confirmar que a
      // conexão ainda está de fato viva.
      await broadcaster.send(connectionId, buildEnvelope('pong', connection.liveId, {}));
      return;
    case 'sync.resume': {
      const result = await resumeLiveSync.execute(connection, {
        since: stringField(payload, 'since'),
      });
      await broadcaster.send(
        connectionId,
        buildEnvelope('sync.resumed', connection.liveId, result),
      );
      return;
    }
    case 'chat.send':
      await sendChatMessage.execute(connection, { body: stringField(payload, 'body') });
      return;
    case 'chat.delete':
      await deleteChatMessage.execute(connection, {
        messageId: stringField(payload, 'messageId'),
      });
      return;
    case 'reaction.send':
      await sendReaction.execute(connection, { emoji: stringField(payload, 'emoji') });
      return;
    case 'question.send':
      await sendQuestion.execute(connection, { body: stringField(payload, 'body') });
      return;
    case 'question.answer':
      await answerQuestion.execute(connection, {
        questionId: stringField(payload, 'questionId'),
      });
      return;
    case 'question.highlight':
      await highlightQuestion.execute(connection, {
        questionId: stringField(payload, 'questionId'),
      });
      return;
    case 'poll.create':
      await createPoll.execute(connection, {
        question: stringField(payload, 'question'),
        options: stringArrayField(payload, 'options'),
      });
      return;
    case 'poll.vote':
      await voteInPoll.execute(connection, {
        pollId: stringField(payload, 'pollId'),
        optionId: stringField(payload, 'optionId'),
      });
      return;
    case 'poll.close':
      await closePoll.execute(connection, { pollId: stringField(payload, 'pollId') });
      return;
    default:
      throw new ValidationError(
        `Ação "${routeKey}" não está implementada nesta fase.`,
        'ROUTE_NOT_IMPLEMENTED',
      );
  }
}

export async function handler(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;
  const connection = await connectionRepository.findByConnectionId(connectionId);

  if (!connection) {
    // Sem registro de conexão não há liveId para endereçar um envelope de erro nem
    // contexto para autorizar a ação — a única resposta segura é encerrar em silêncio.
    return { statusCode: 200 };
  }

  const liveConnectionContext: LiveConnectionContext = {
    liveId: connection.liveId,
    userId: connection.userId,
    liveParticipantId: connection.liveParticipantId,
    role: connection.role,
  };

  try {
    const payload = asRecord(event.body);
    await dispatch(event.requestContext.routeKey, connectionId, liveConnectionContext, payload);
  } catch (error) {
    if (error instanceof DomainError) {
      await broadcaster.send(
        connectionId,
        buildEnvelope('error', connection.liveId, {
          code: error.code,
          message: error.publicMessage,
        }),
      );
      return { statusCode: 200 };
    }

    // Erro inesperado (bug, falha do SDK): avisa o cliente com uma mensagem genérica,
    // mas relança — precisa aparecer como falha de invocação no CloudWatch, não ser
    // mascarado como se fosse uma recusa de negócio normal.
    await broadcaster.send(
      connectionId,
      buildEnvelope('error', connection.liveId, {
        code: 'INTERNAL_ERROR',
        message: 'Ocorreu um erro inesperado. Tente novamente.',
      }),
    );
    throw error;
  }

  return { statusCode: 200 };
}
