import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbConnectionTicketRepository } from '@/infrastructure/repositories/dynamodb-connection-ticket-repository';
import type { ConnectionTicket } from '@/domain/entities/ConnectionTicket';
import { launchDynamoDbLocal, stopDynamoDbLocal } from './support/dynamodb-local';

// Porta própria — pode rodar em paralelo com os outros testes de integração.
const PORT = 8203;
const TABLE_NAME = 'test-core-table-connection-ticket';

let rawClient: DynamoDBClient;
let repository: DynamoDbConnectionTicketRepository;

function buildTicket(overrides: Partial<ConnectionTicket> = {}): ConnectionTicket {
  const now = new Date();
  return {
    ticket: 'ticket-1',
    liveId: 'live-1',
    userId: 'user-1',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  rawClient = await launchDynamoDbLocal(PORT);

  await rawClient.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    }),
  );

  repository = new DynamoDbConnectionTicketRepository(DynamoDBDocumentClient.from(rawClient), TABLE_NAME);
}, 30_000);

afterAll(async () => {
  await rawClient.send(new DeleteTableCommand({ TableName: TABLE_NAME })).catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

describe('DynamoDbConnectionTicketRepository — uso único do connectionToken contra DynamoDB Local', () => {
  it('consome um ticket válido uma vez; uma segunda tentativa com o mesmo ticket é rejeitada (reuso)', async () => {
    const ticket = buildTicket({ ticket: 'reuse-me' });
    await repository.create(ticket);

    const first = await repository.consume('reuse-me');
    expect(first).toEqual({ liveId: 'live-1', userId: 'user-1' });

    const second = await repository.consume('reuse-me');
    expect(second).toBeNull();
  });

  it('rejeita um ticket que nunca existiu', async () => {
    const result = await repository.consume('never-created');
    expect(result).toBeNull();
  });

  it('rejeita um ticket expirado mesmo que o item ainda exista fisicamente (TTL do DynamoDB é best-effort)', async () => {
    const expired = buildTicket({
      ticket: 'already-expired',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await repository.create(expired);

    const result = await repository.consume('already-expired');
    expect(result).toBeNull();
  });

  it('duas tentativas concorrentes de consumir o mesmo ticket: só uma vence', async () => {
    const ticket = buildTicket({ ticket: 'concurrent' });
    await repository.create(ticket);

    const [first, second] = await Promise.all([
      repository.consume('concurrent'),
      repository.consume('concurrent'),
    ]);

    const successes = [first, second].filter((result) => result !== null);
    expect(successes).toHaveLength(1);
  });
});
