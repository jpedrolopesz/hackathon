import 'server-only';
import type {
  APIGatewayEventWebsocketRequestContextV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2WithRequestContext,
} from 'aws-lambda';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { ConnectToLiveUseCase } from '@/application/use-cases/connect-to-live';
import { DomainError } from '@/domain/errors/DomainError';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { DynamoDbAttendanceRepository } from '@/infrastructure/repositories/dynamodb-attendance-repository';
import { DynamoDbLiveParticipantRepository } from '@/infrastructure/repositories/dynamodb-live-participant-repository';
import { DynamoDbLiveSessionRepository } from '@/infrastructure/repositories/dynamodb-live-session-repository';
import { DynamoDbWebSocketConnectionRepository } from '@/infrastructure/repositories/dynamodb-websocket-connection-repository';
import { httpStatusForError } from '@/shared/http/httpStatusForError';
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

const connectToLive = new ConnectToLiveUseCase(
  new DynamoDbLiveSessionRepository(documentClient, tableName),
  new DynamoDbLiveParticipantRepository(documentClient, tableName),
  new DynamoDbWebSocketConnectionRepository(documentClient, tableName),
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
    await connectToLive.execute(context, {
      liveId: event.requestContext.authorizer.liveId,
      connectionId: event.requestContext.connectionId,
    });
    return { statusCode: 200 };
  } catch (error) {
    if (error instanceof DomainError) {
      return { statusCode: httpStatusForError(error), body: error.publicMessage };
    }
    throw error;
  }
}
