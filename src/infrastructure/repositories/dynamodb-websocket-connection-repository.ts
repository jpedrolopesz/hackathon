import 'server-only';
import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import type { WebSocketConnection } from '@/domain/entities/WebSocketConnection';

// TTL de segurança contra $disconnect perdido (docs/fase-1-arquitetura.md, seção 6/10.3).
const CONNECTION_TTL_SECONDS = 2 * 60 * 60;

export class DynamoDbWebSocketConnectionRepository implements WebSocketConnectionRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(connection: WebSocketConnection): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `LIVE#${connection.liveId}`,
          SK: `CONNECTION#${connection.connectionId}`,
          GSI2PK: `CONNECTION#${connection.connectionId}`,
          GSI2SK: `CONNECTION#${connection.connectionId}`,
          ttl,
          ...connection,
        },
      }),
    );
  }

  async findByConnectionId(connectionId: string): Promise<WebSocketConnection | null> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `CONNECTION#${connectionId}` },
        Limit: 1,
      }),
    );
    const item = result.Items?.[0];
    return item ? toWebSocketConnection(item) : null;
  }

  async removeByConnectionId(connectionId: string): Promise<void> {
    const connection = await this.findByConnectionId(connectionId);
    if (!connection) return;
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `LIVE#${connection.liveId}`, SK: `CONNECTION#${connectionId}` },
      }),
    );
  }

  async listByLive(liveId: string): Promise<readonly WebSocketConnection[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LIVE#${liveId}`, ':prefix': 'CONNECTION#' },
        // Padrão de acesso #11 (broadcast) — leitura forte, ver docs/fase-1-
        // arquitetura.md seção 10.5: uma conexão recém-criada não pode ficar de fora
        // de um broadcast por causa de defasagem de replicação eventual.
        ConsistentRead: true,
      }),
    );
    return (result.Items ?? []).map(toWebSocketConnection);
  }
}

function toWebSocketConnection(item: Record<string, unknown>): WebSocketConnection {
  return {
    connectionId: item['connectionId'] as string,
    liveId: item['liveId'] as string,
    userId: item['userId'] as string,
    liveParticipantId: item['liveParticipantId'] as string,
    role: item['role'] as WebSocketConnection['role'],
    connectedAt: item['connectedAt'] as string,
  };
}
