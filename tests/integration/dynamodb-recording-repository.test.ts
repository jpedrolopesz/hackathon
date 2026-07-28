import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbRecordingRepository } from '@/infrastructure/repositories/dynamodb-recording-repository';
import type { Recording } from '@/domain/entities/Recording';
import { statusesThatCanTransitionTo } from '@/domain/value-objects/RecordingStatus';
import { launchDynamoDbLocal, stopDynamoDbLocal } from './support/dynamodb-local';

// Porta própria — pode rodar em paralelo com os outros testes de integração.
const PORT = 8204;
const TABLE_NAME = 'test-core-table-recording';

let rawClient: DynamoDBClient;
let repository: DynamoDbRecordingRepository;

function buildRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    recordingId: 'recording-int-1',
    liveId: 'live-int-1',
    courseId: 'course-int-1',
    institutionId: 'institution-1',
    stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage',
    status: 'STARTING',
    startedAt: '2026-01-01T00:00:00.000Z',
    visibility: 'DRAFT',
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
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
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

  repository = new DynamoDbRecordingRepository(DynamoDBDocumentClient.from(rawClient), TABLE_NAME);
}, 30_000);

afterAll(async () => {
  await rawClient.send(new DeleteTableCommand({ TableName: TABLE_NAME })).catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

describe('DynamoDbRecordingRepository — máquina de estados contra DynamoDB Local', () => {
  it('create + findById (via GSI2) retorna o item gravado', async () => {
    const recording = buildRecording({ recordingId: 'recording-int-create' });
    await repository.create(recording);

    const found = await repository.findById('recording-int-create');
    expect(found?.status).toBe('STARTING');
    expect(found?.courseId).toBe('course-int-1');
  });

  it('findByCourse lista as gravações da disciplina, mais recentes primeiro', async () => {
    const courseId = 'course-int-listing';
    await repository.create(
      buildRecording({ recordingId: 'r1', courseId, startedAt: '2026-01-01T00:00:00.000Z' }),
    );
    await repository.create(
      buildRecording({ recordingId: 'r2', courseId, startedAt: '2026-01-02T00:00:00.000Z' }),
    );

    const page = await repository.findByCourse(courseId, 10);

    expect(page.recordings.map((r) => r.recordingId)).toEqual(['r2', 'r1']);
  });

  it('applyEvent rejeita um evento duplicado (mesmo event_time reaplicado)', async () => {
    const recording = buildRecording({ recordingId: 'recording-int-duplicate', status: 'RECORDING' });
    await repository.create(recording);

    const first = await repository.applyEvent(
      'recording-int-duplicate',
      '2026-01-01T00:05:00.000Z',
      statusesThatCanTransitionTo('PROCESSING'),
      { status: 'PROCESSING', endedAt: '2026-01-01T00:05:00.000Z' },
    );
    expect(first).toBe('applied');

    const duplicate = await repository.applyEvent(
      'recording-int-duplicate',
      '2026-01-01T00:05:00.000Z',
      statusesThatCanTransitionTo('PROCESSING'),
      { status: 'PROCESSING', endedAt: '2026-01-01T00:05:00.000Z' },
    );
    expect(duplicate).toBe('stale');

    const found = await repository.findById('recording-int-duplicate');
    expect(found?.status).toBe('PROCESSING');
  });

  it('applyEvent rejeita um evento fora de ordem (event_time mais antigo que o já aplicado)', async () => {
    const recording = buildRecording({ recordingId: 'recording-int-out-of-order', status: 'RECORDING' });
    await repository.create(recording);

    await repository.applyEvent(
      'recording-int-out-of-order',
      '2026-01-01T00:05:00.000Z',
      statusesThatCanTransitionTo('PROCESSING'),
      { status: 'PROCESSING' },
    );

    // Um "Session Start" atrasado (event_time mais antigo) chega depois do "Session
    // End" já aplicado — não pode regredir PROCESSING de volta para RECORDING.
    const stale = await repository.applyEvent(
      'recording-int-out-of-order',
      '2026-01-01T00:01:00.000Z',
      statusesThatCanTransitionTo('RECORDING'),
      { status: 'RECORDING' },
    );
    expect(stale).toBe('stale');

    const found = await repository.findById('recording-int-out-of-order');
    expect(found?.status).toBe('PROCESSING');
  });

  it('applyEvent retorna not_found para um recordingId inexistente', async () => {
    const result = await repository.applyEvent(
      'does-not-exist',
      '2026-01-01T00:00:00.000Z',
      statusesThatCanTransitionTo('RECORDING'),
      { status: 'RECORDING' },
    );
    expect(result).toBe('not_found');
  });

  it('duas atualizações concorrentes para a mesma transição: só uma vence (ConditionExpression real)', async () => {
    const recording = buildRecording({ recordingId: 'recording-int-concurrent', status: 'RECORDING' });
    await repository.create(recording);

    const results = await Promise.all([
      repository.applyEvent(
        'recording-int-concurrent',
        '2026-01-01T00:05:00.000Z',
        statusesThatCanTransitionTo('PROCESSING'),
        { status: 'PROCESSING' },
      ),
      repository.applyEvent(
        'recording-int-concurrent',
        '2026-01-01T00:05:00.000Z',
        statusesThatCanTransitionTo('PROCESSING'),
        { status: 'PROCESSING' },
      ),
    ]);

    const applied = results.filter((result) => result === 'applied');
    expect(applied).toHaveLength(1);
  });

  it('publish só funciona com status READY, e hide devolve para HIDDEN sem tocar demais campos', async () => {
    const recording = buildRecording({
      recordingId: 'recording-int-publish',
      status: 'READY',
      manifestPath: 'course-int-1/live-int-1/master.m3u8',
    });
    await repository.create(recording);

    await expect(repository.publish('recording-int-publish')).resolves.toBeUndefined();
    expect((await repository.findById('recording-int-publish'))?.visibility).toBe('PUBLISHED');

    await repository.hide('recording-int-publish');
    const hidden = await repository.findById('recording-int-publish');
    expect(hidden?.status).toBe('HIDDEN');
    expect(hidden?.manifestPath).toBe('course-int-1/live-int-1/master.m3u8');
  });

  it('publish rejeita uma gravação que não está READY', async () => {
    const recording = buildRecording({ recordingId: 'recording-int-not-ready', status: 'PROCESSING' });
    await repository.create(recording);

    await expect(repository.publish('recording-int-not-ready')).rejects.toMatchObject({
      code: 'RECORDING_NOT_READY',
    });
  });
});
