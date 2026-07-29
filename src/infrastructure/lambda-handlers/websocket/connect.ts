import 'server-only';
import type {
  APIGatewayEventWebsocketRequestContextV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2WithRequestContext,
} from 'aws-lambda';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { ConnectToLiveUseCase } from '@/application/use-cases/connect-to-live';
import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import { DomainError } from '@/domain/errors/DomainError';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';
import { ApiGatewayRealtimeBroadcaster } from '@/infrastructure/aws/api-gateway/realtime-broadcaster';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { DynamoDbAttendanceRepository } from '@/infrastructure/repositories/dynamodb-attendance-repository';
import { DynamoDbLiveParticipantRepository } from '@/infrastructure/repositories/dynamodb-live-participant-repository';
import { DynamoDbLiveSessionRepository } from '@/infrastructure/repositories/dynamodb-live-session-repository';
import { DynamoDbWebSocketConnectionRepository } from '@/infrastructure/repositories/dynamodb-websocket-connection-repository';
import { httpStatusForError } from '@/shared/http/httpStatusForError';
import { emitMetric, structuredLog } from '@/shared/observability/structured-log';
import type { WebSocketAuthorizerContext } from './authorizer';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não definida.`);
  }
  return value;
}

const tableName = requiredEnv('DYNAMODB_TABLE_NAME');
const documentClient = getDocumentClient();

const liveParticipantRepository = new DynamoDbLiveParticipantRepository(documentClient, tableName);
const connectionRepository = new DynamoDbWebSocketConnectionRepository(documentClient, tableName);
const broadcaster = new ApiGatewayRealtimeBroadcaster(requiredEnv('WEBSOCKET_API_ENDPOINT'));
const connectToLive = new ConnectToLiveUseCase(
  new DynamoDbLiveSessionRepository(documentClient, tableName),
  liveParticipantRepository,
  connectionRepository,
  new DynamoDbAttendanceRepository(documentClient, tableName),
);

type ConnectRequestContext = APIGatewayEventWebsocketRequestContextV2 & {
  authorizer: WebSocketAuthorizerContext;
};
type ConnectEvent = APIGatewayProxyWebsocketEventV2WithRequestContext<ConnectRequestContext>;

/**
 * Autenticação já aconteceu no Lambda authorizer da rota, que consumiu o
 * `connectionToken` de uso único e resolveu `userId`/`institutionId`/`role`/`liveId`
 * (docs/fase-1-arquitetura.md, seção 10.1) — `liveId` vem do próprio ticket, nunca de
 * um parâmetro de query separado (não há mais nenhum dado sensível ou identificador
 * na URL além do ticket opaco). Este handler só resolve a autorização específica da
 * live e grava a conexão. Retornar status != 2xx aqui aborta o handshake do
 * WebSocket, então erros de autorização (instituição errada, ainda não entrou na
 * aula) rejeitam a conexão em vez de abrir e falhar depois.
 */
export async function handler(event: ConnectEvent): Promise<APIGatewayProxyResultV2> {
  const context: AuthenticatedRequestContext = {
    userId: event.requestContext.authorizer.userId,
    institutionId: event.requestContext.authorizer.institutionId,
    role: event.requestContext.authorizer.role as AuthenticatedRequestContext['role'],
  };

  try {
    const connection = await connectToLive.execute(context, {
      liveId: event.requestContext.authorizer.liveId,
      connectionId: event.requestContext.connectionId,
    });
    const participant = await liveParticipantRepository.findByUser(
      connection.liveId,
      connection.userId,
    );
    if (participant) {
      await broadcastToLive(
        connectionRepository,
        broadcaster,
        connection.liveId,
        buildEnvelope('participant.connected', connection.liveId, participant),
      );
    }
    emitMetric('WebSocketConnectionsOpened');
    structuredLog('info', {
      event: 'websocket.connected',
      correlationId: event.requestContext.requestId,
      requestId: event.requestContext.requestId,
      liveId: connection.liveId,
    });
    return { statusCode: 200 };
  } catch (error) {
    if (error instanceof DomainError) {
      return { statusCode: httpStatusForError(error), body: error.publicMessage };
    }
    throw error;
  }
}
