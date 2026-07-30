import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  ConnectionTicketRepository,
  ConsumedConnectionTicket,
} from '@/application/ports/ConnectionTicketRepository';
import type { ConnectionTicket } from '@/domain/entities/ConnectionTicket';

/**
 * `ttl` (epoch seconds) faz dupla função: expiração automática da tabela E o próprio
 * limite de validade checado em `consume`. TTL do DynamoDB é best-effort — a AWS
 * documenta até 48h de atraso entre o timestamp e a exclusão real do item — então
 * confiar só na exclusão deixaria um ticket "expirado" ainda consumível por até 48h.
 * Por isso `consume` valida `ttl > :nowEpoch` na própria `ConditionExpression`, não
 * depende da limpeza em segundo plano para a garantia de segurança.
 */
export class DynamoDbConnectionTicketRepository implements ConnectionTicketRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(ticket: ConnectionTicket): Promise<void> {
    const ttl = Math.floor(new Date(ticket.expiresAt).getTime() / 1000);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `CONNTICKET#${ticket.ticket}`,
          SK: 'CONNTICKET',
          ttl,
          ...ticket,
        },
      }),
    );
  }

  async consume(ticket: string): Promise<ConsumedConnectionTicket | null> {
    const nowEpoch = Math.floor(Date.now() / 1000);
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `CONNTICKET#${ticket}`, SK: 'CONNTICKET' },
          UpdateExpression: 'SET consumedAt = :now',
          ConditionExpression:
            'attribute_exists(PK) AND attribute_not_exists(consumedAt) AND #ttl > :nowEpoch',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':now': new Date().toISOString(), ':nowEpoch': nowEpoch },
          ReturnValues: 'ALL_NEW',
        }),
      );
      const item = result.Attributes;
      if (!item) {
        return null;
      }
      return { liveId: item['liveId'] as string, userId: item['userId'] as string };
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return null;
      }
      throw error;
    }
  }
}
