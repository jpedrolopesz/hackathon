import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { RateLimiter } from '@/application/ports/RateLimiter';

// Margem sobre a janela antes do TTL expirar o item — evita apagar o contador
// exatamente na borda enquanto ainda pode haver uma escrita em voo.
const TTL_MARGIN_SECONDS = 60;

/**
 * Janela fixa (padrão de acesso #14, docs/fase-1-arquitetura.md seção 10.4):
 * PK=RATELIMIT#{key}, SK=WINDOW#{windowStart}. `ADD hits :one` com
 * `ConditionExpression` sobre o valor ANTES do incremento — é o próprio DynamoDB
 * que decide atomicamente se a chamada conta ou é recusada, sem race condition.
 */
export class DynamoDbRateLimiter implements RateLimiter {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
    const ttl = windowStart + windowSeconds + TTL_MARGIN_SECONDS;

    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `RATELIMIT#${key}`, SK: `WINDOW#${windowStart}` },
          UpdateExpression: 'SET #ttl = if_not_exists(#ttl, :ttl) ADD hits :one',
          ConditionExpression: 'attribute_not_exists(hits) OR hits < :limit',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':limit': limit, ':ttl': ttl },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
  }
}
