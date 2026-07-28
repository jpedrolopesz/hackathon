import 'server-only';
import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { DisconnectFromLiveUseCase } from '@/application/use-cases/disconnect-from-live';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { DynamoDbAttendanceRepository } from '@/infrastructure/repositories/dynamodb-attendance-repository';
import { DynamoDbWebSocketConnectionRepository } from '@/infrastructure/repositories/dynamodb-websocket-connection-repository';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não definida.`);
  }
  return value;
}

const tableName = requiredEnv('DYNAMODB_TABLE_NAME');

const documentClient = getDocumentClient();

const disconnectFromLive = new DisconnectFromLiveUseCase(
  new DynamoDbWebSocketConnectionRepository(documentClient, tableName),
  new DynamoDbAttendanceRepository(documentClient, tableName),
);

export async function handler(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> {
  await disconnectFromLive.execute(event.requestContext.connectionId);
  return { statusCode: 200 };
}
