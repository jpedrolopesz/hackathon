import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbLiveSessionRepository } from '@/infrastructure/repositories/dynamodb-live-session-repository';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { launchDynamoDbLocal, stopDynamoDbLocal } from './support/dynamodb-local';

// Porta diferente da usada em dynamodb-upcoming-live-repository.test.ts — os dois
// arquivos podem rodar em processos/workers separados do Vitest ao mesmo tempo.
const PORT = 8200;
const TABLE_NAME = 'test-core-table-live-session';

let rawClient: DynamoDBClient;
let repository: DynamoDbLiveSessionRepository;

function buildLive(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    liveId: 'live-int-1',
    classId: 'class-int-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula de integração',
    scheduledStartAt: '2099-01-01T14:00:00.000Z',
    status: 'SCHEDULED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );

  repository = new DynamoDbLiveSessionRepository(
    DynamoDBDocumentClient.from(rawClient),
    TABLE_NAME,
  );
}, 30_000);

afterAll(async () => {
  await rawClient.send(new DeleteTableCommand({ TableName: TABLE_NAME })).catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

describe('DynamoDbLiveSessionRepository — padrão de acesso #6 (leitura forte + escrita condicional) contra DynamoDB Local', () => {
  it('create + findById com ConsistentRead retorna o item gravado', async () => {
    const live = buildLive({ liveId: 'live-int-create' });
    await repository.create(live);

    const found = await repository.findById('live-int-create');
    expect(found?.status).toBe('SCHEDULED');
    expect(found?.teacherId).toBe('teacher-1');
  });

  it('create rejeita um liveId duplicado (ConditionExpression attribute_not_exists)', async () => {
    const live = buildLive({ liveId: 'live-int-dup' });
    await repository.create(live);

    await expect(repository.create(live)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('transitionStatus aplica só se o status atual bater com o esperado — é isso que torna start/finish idempotentes', async () => {
    const live = buildLive({ liveId: 'live-int-transition' });
    await repository.create(live);

    await repository.transitionStatus('live-int-transition', 'SCHEDULED', 'WAITING');
    const afterFirst = await repository.findById('live-int-transition');
    expect(afterFirst?.status).toBe('WAITING');

    // Uma segunda tentativa partindo do MESMO status esperado (SCHEDULED) tem que
    // falhar — é exatamente o cenário de duas chamadas concorrentes de /start.
    await expect(
      repository.transitionStatus('live-int-transition', 'SCHEDULED', 'WAITING'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('attachStage falha se o stageArn já estiver setado — evita sobrescrever um Stage já provisionado', async () => {
    const live = buildLive({ liveId: 'live-int-attach' });
    await repository.create(live);
    await repository.transitionStatus('live-int-attach', 'SCHEDULED', 'WAITING');

    await repository.attachStage(
      'live-int-attach',
      'WAITING',
      'arn:aws:ivs:us-east-1:123456789012:stage/first',
    );

    await expect(
      repository.attachStage(
        'live-int-attach',
        'WAITING',
        'arn:aws:ivs:us-east-1:123456789012:stage/second',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const found = await repository.findById('live-int-attach');
    expect(found?.stageArn).toBe('arn:aws:ivs:us-east-1:123456789012:stage/first');
  });

  it('findByStageArn (padrão #13, GSI2) resolve a live a partir do stageArn', async () => {
    const live = buildLive({ liveId: 'live-int-stage-lookup' });
    await repository.create(live);
    await repository.transitionStatus('live-int-stage-lookup', 'SCHEDULED', 'WAITING');
    await repository.attachStage(
      'live-int-stage-lookup',
      'WAITING',
      'arn:aws:ivs:us-east-1:123456789012:stage/lookup-me',
    );

    const found = await repository.findByStageArn(
      'arn:aws:ivs:us-east-1:123456789012:stage/lookup-me',
    );
    expect(found?.liveId).toBe('live-int-stage-lookup');
  });

  it('concorrência real: de duas chamadas simultâneas de transitionStatus a partir do mesmo status, só uma vence', async () => {
    const live = buildLive({ liveId: 'live-int-concurrent', status: 'WAITING' });
    await repository.create(live);

    const results = await Promise.allSettled([
      repository.transitionStatus('live-int-concurrent', 'WAITING', 'LIVE'),
      repository.transitionStatus('live-int-concurrent', 'WAITING', 'LIVE'),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const found = await repository.findById('live-int-concurrent');
    expect(found?.status).toBe('LIVE');
  });
});
