import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbUpcomingLiveRepository } from '@/infrastructure/repositories/dynamodb-upcoming-live-repository';
import type { UpcomingLiveSummary } from '@/application/ports/UpcomingLiveRepository';
import { launchDynamoDbLocal, stopDynamoDbLocal } from './support/dynamodb-local';

const PORT = 8199;
const TABLE_NAME = 'test-core-table';

let rawClient: DynamoDBClient;
let repository: DynamoDbUpcomingLiveRepository;

/** Grava a LiveSession diretamente na tabela — não existe LiveSessionRepository ainda
 * (é Fase 5); o padrão de acesso #4 é o mesmo que essa live vai usar quando existir. */
async function seedLive(classId: string, live: UpcomingLiveSummary): Promise<void> {
  const doc = DynamoDBDocumentClient.from(rawClient);
  await doc.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `LIVE#${live.liveId}`,
        SK: 'METADATA',
        GSI1PK: `CLASS#${classId}`,
        GSI1SK: `${live.scheduledStartAt}#${live.liveId}`,
        liveId: live.liveId,
        classId: live.classId,
        title: live.title,
        scheduledStartAt: live.scheduledStartAt,
      },
    }),
  );
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
      ],
    }),
  );

  repository = new DynamoDbUpcomingLiveRepository(
    DynamoDBDocumentClient.from(rawClient),
    TABLE_NAME,
  );
}, 30_000);

afterAll(async () => {
  await rawClient.send(new DeleteTableCommand({ TableName: TABLE_NAME })).catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

describe('DynamoDbUpcomingLiveRepository — padrões de acesso #4 e #5 contra DynamoDB Local', () => {
  it('listUpcomingByClass (padrão #4, GSI1) só retorna lives com scheduledStartAt no futuro', async () => {
    await seedLive('class-int-1', {
      liveId: 'live-past',
      classId: 'class-int-1',
      title: 'Aula passada',
      scheduledStartAt: '2020-01-01T00:00:00.000Z',
    });
    await seedLive('class-int-1', {
      liveId: 'live-future',
      classId: 'class-int-1',
      title: 'Aula futura',
      scheduledStartAt: '2099-01-01T00:00:00.000Z',
    });

    const lives = await repository.listUpcomingByClass('class-int-1');

    expect(lives.map((live) => live.liveId)).toEqual(['live-future']);
  });

  it('projectForStudent (padrão #5) grava projeções lidas de volta na partição do aluno', async () => {
    const lives: UpcomingLiveSummary[] = [
      {
        liveId: 'live-a',
        classId: 'class-int-2',
        title: 'Aula A',
        scheduledStartAt: '2099-02-01T00:00:00.000Z',
      },
      {
        liveId: 'live-b',
        classId: 'class-int-2',
        title: 'Aula B',
        scheduledStartAt: '2099-02-08T00:00:00.000Z',
      },
    ];

    await repository.projectForStudent('student-int-1', lives);

    const result = await rawClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#student-int-1' },
          ':prefix': { S: 'UPCOMING#' },
        },
      }),
    );

    expect(result.Items).toHaveLength(2);
  });

  it('removeForStudent (padrão #5) apaga as projeções gravadas', async () => {
    const lives: UpcomingLiveSummary[] = [
      {
        liveId: 'live-c',
        classId: 'class-int-3',
        title: 'Aula C',
        scheduledStartAt: '2099-03-01T00:00:00.000Z',
      },
    ];
    await repository.projectForStudent('student-int-2', lives);

    await repository.removeForStudent('student-int-2', ['live-c']);

    const result = await rawClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#student-int-2' },
          ':prefix': { S: 'UPCOMING#' },
        },
      }),
    );

    expect(result.Items).toHaveLength(0);
  });

  it('projeta mais de 25 lives (limite real do BatchWriteItem) provando que o chunking funciona', async () => {
    const lives: UpcomingLiveSummary[] = Array.from({ length: 30 }, (_, index) => ({
      liveId: `live-batch-${index}`,
      classId: 'class-int-4',
      title: `Aula ${index}`,
      scheduledStartAt: `2099-04-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));

    await repository.projectForStudent('student-int-3', lives);

    const result = await rawClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#student-int-3' },
          ':prefix': { S: 'UPCOMING#' },
        },
      }),
    );

    expect(result.Items).toHaveLength(30);
  });
});
