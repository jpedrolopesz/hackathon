import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { DisconnectFromLiveUseCase } from '@/application/use-cases/disconnect-from-live';
import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';
import { ApiGatewayRealtimeBroadcaster } from '@/infrastructure/aws/api-gateway/realtime-broadcaster';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { DynamoDbAttendanceRepository } from '@/infrastructure/repositories/dynamodb-attendance-repository';
import { DynamoDbWebSocketConnectionRepository } from '@/infrastructure/repositories/dynamodb-websocket-connection-repository';
import { emitMetric, structuredLog } from '@/shared/observability/structured-log';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não definida.`);
  }
  return value;
}

const tableName = requiredEnv('DYNAMODB_TABLE_NAME');

const documentClient = getDocumentClient();

const connectionRepository = new DynamoDbWebSocketConnectionRepository(documentClient, tableName);
const broadcaster = new ApiGatewayRealtimeBroadcaster(requiredEnv('WEBSOCKET_API_ENDPOINT'));
const disconnectFromLive = new DisconnectFromLiveUseCase(
  connectionRepository,
  new DynamoDbAttendanceRepository(documentClient, tableName),
);

export async function handler(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> {
  const connection = await connectionRepository.findByConnectionId(
    event.requestContext.connectionId,
  );
  await disconnectFromLive.execute(event.requestContext.connectionId);
  emitMetric('WebSocketConnectionsClosed');
  structuredLog('info', {
    event: 'websocket.disconnected',
    correlationId: event.requestContext.requestId,
    requestId: event.requestContext.requestId,
    ...(connection ? { liveId: connection.liveId } : {}),
  });
  if (connection) {
    // Reconexão preventiva abre o socket novo antes de fechar o velho. Só anuncia
    // saída quando não sobrou nenhuma conexão desse participante.
    const remainingConnections = await connectionRepository.listByLive(connection.liveId);
    const isStillConnected = remainingConnections.some(
      (remaining) => remaining.liveParticipantId === connection.liveParticipantId,
    );
    if (!isStillConnected) {
      await broadcastToLive(
        connectionRepository,
        broadcaster,
        connection.liveId,
        buildEnvelope('participant.disconnected', connection.liveId, {
          liveParticipantId: connection.liveParticipantId,
        }),
      );
    }
  }
  return { statusCode: 200 };
}
