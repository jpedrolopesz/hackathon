import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import seedPayload from '../../seeds/estatistica-i.json';
import { DynamoDbGraphRepository } from '@/infrastructure/repositories/dynamodb-graph-repository';
import { loadGraphSeed } from '@/infrastructure/seed/load-graph-seed';
import { parseGraphSeed } from '@/infrastructure/seed/graph-seed-schema';
import {
  launchDynamoDbLocal,
  stopDynamoDbLocal,
} from './support/dynamodb-local';

const PORT = 8213;
const TABLE_NAME = 'test-core-table-graph-repository';

let rawClient: DynamoDBClient;
let repository: DynamoDbGraphRepository;

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

  const documentClient = DynamoDBDocumentClient.from(rawClient);
  await loadGraphSeed(documentClient, TABLE_NAME, {
    institutionId: 'institution-1',
    seed: parseGraphSeed(seedPayload),
  });
  repository = new DynamoDbGraphRepository(documentClient, TABLE_NAME);
}, 30_000);

afterAll(async () => {
  await rawClient
    .send(new DeleteTableCommand({ TableName: TABLE_NAME }))
    .catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

describe('DynamoDbGraphRepository', () => {
  it('returns exactly the eight prerequisite edges from the seed', async () => {
    const edges = await repository.findPrerequisiteEdges(
      'institution-1',
      'discipline-statistics',
    );

    expect(edges).toHaveLength(8);
    expect(
      edges.every((edge) => edge.type === 'PREREQUISITE_OF'),
    ).toBe(true);
  });

  it('does not return module or material coverage edges', async () => {
    const edges = await repository.findPrerequisiteEdges(
      'institution-1',
      'discipline-statistics',
    );

    expect(
      edges.some(
        (edge) =>
          edge.type === 'BELONGS_TO_MODULE' ||
          edge.type === 'COVERS_CONCEPT',
      ),
    ).toBe(false);
  });

  it('preserves prerequisite-to-dependent direction', async () => {
    const edges = await repository.findPrerequisiteEdges(
      'institution-1',
      'discipline-statistics',
    );

    expect(edges).toContainEqual(
      expect.objectContaining({
        type: 'PREREQUISITE_OF',
        fromNodeId: 'concept-frequency-tables',
        toNodeId: 'concept-histogram',
      }),
    );
  });

  it('returns an empty list for a different institution', async () => {
    await expect(
      repository.findPrerequisiteEdges(
        'institution-2',
        'discipline-statistics',
      ),
    ).resolves.toEqual([]);
  });

  it('returns an empty list for a discipline without a seed', async () => {
    await expect(
      repository.findPrerequisiteEdges(
        'institution-1',
        'discipline-missing',
      ),
    ).resolves.toEqual([]);
  });
});
