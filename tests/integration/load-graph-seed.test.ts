import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import seedPayload from '../../seeds/estatistica-i.json';
import { loadGraphSeed } from '@/infrastructure/seed/load-graph-seed';
import {
  parseGraphSeed,
  type GraphSeed,
} from '@/infrastructure/seed/graph-seed-schema';
import {
  launchDynamoDbLocal,
  stopDynamoDbLocal,
} from './support/dynamodb-local';

const PORT = 8212;
const TABLE_NAME = 'test-core-table-graph-seed';

let rawClient: DynamoDBClient;
let documentClient: DynamoDBDocumentClient;
const seed = parseGraphSeed(seedPayload);

async function queryDiscipline(
  disciplineId: string,
): Promise<readonly Record<string, unknown>[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `DISC#${disciplineId}`,
      },
    }),
  );
  return result.Items ?? [];
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
  documentClient = DynamoDBDocumentClient.from(rawClient);
}, 30_000);

afterAll(async () => {
  await rawClient
    .send(new DeleteTableCommand({ TableName: TABLE_NAME }))
    .catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

describe('loadGraphSeed', () => {
  it('loads discipline, nodes, materials and institutional edges', async () => {
    const result = await loadGraphSeed(documentClient, TABLE_NAME, {
      institutionId: 'institution-1',
      seed,
    });
    const items = await queryDiscipline(seed.discipline.id);
    const keys = items.map((item) => item['SK'] as string);

    expect(result.itemsWritten).toBe(69);
    expect(keys.filter((key) => key === 'METADATA')).toHaveLength(1);
    expect(
      keys.filter((key) => key.startsWith('NODE#CONCEPT#')),
    ).toHaveLength(15);
    expect(
      keys.filter((key) => key.startsWith('NODE#MODULE#')),
    ).toHaveLength(4);
    expect(
      keys.filter((key) => key.startsWith('NODE#MATERIAL#')),
    ).toHaveLength(4);
    expect(
      keys.filter((key) => key.startsWith('MATERIAL#')),
    ).toHaveLength(4);
    expect(
      keys.filter((key) => key.startsWith('EDGE#BELONGS_TO_MODULE#')),
    ).toHaveLength(15);
    expect(
      keys.filter((key) => key.startsWith('EDGE#PREREQUISITE_OF#')),
    ).toHaveLength(8);
    expect(
      keys.filter((key) => key.startsWith('EDGE#COVERS_CONCEPT#')),
    ).toHaveLength(18);
  });

  it('is idempotent when the same seed is loaded twice', async () => {
    const idempotentSeed: GraphSeed = {
      ...seed,
      discipline: {
        ...seed.discipline,
        id: 'discipline-statistics-idempotent',
      },
    };

    await loadGraphSeed(documentClient, TABLE_NAME, {
      institutionId: 'institution-idempotent',
      seed: idempotentSeed,
    });
    const afterFirstLoad = await queryDiscipline(
      idempotentSeed.discipline.id,
    );
    await loadGraphSeed(documentClient, TABLE_NAME, {
      institutionId: 'institution-idempotent',
      seed: idempotentSeed,
    });
    const afterSecondLoad = await queryDiscipline(
      idempotentSeed.discipline.id,
    );

    expect(afterFirstLoad).toHaveLength(69);
    expect(afterSecondLoad).toHaveLength(afterFirstLoad.length);
  });

  it('writes the input institutionId to every item', async () => {
    const institutionSeed: GraphSeed = {
      ...seed,
      discipline: {
        ...seed.discipline,
        id: 'discipline-statistics-institution',
      },
    };

    await loadGraphSeed(documentClient, TABLE_NAME, {
      institutionId: 'institution-audit',
      seed: institutionSeed,
    });
    const items = await queryDiscipline(institutionSeed.discipline.id);

    expect(items).toHaveLength(69);
    expect(
      items.every(
        (item) => item['institutionId'] === 'institution-audit',
      ),
    ).toBe(true);
  });

  it('does not write a DOUBT node to the institutional partition', async () => {
    const items = await queryDiscipline(seed.discipline.id);

    expect(items.some((item) => item['type'] === 'DOUBT')).toBe(false);
    expect(
      items.some((item) => String(item['SK']).includes('DOUBT')),
    ).toBe(false);
  });

  it('keeps another institution isolated when its discipline is different', async () => {
    const alternateSeed: GraphSeed = {
      ...seed,
      discipline: {
        ...seed.discipline,
        id: 'discipline-statistics-alternate',
      },
    };
    await loadGraphSeed(documentClient, TABLE_NAME, {
      institutionId: 'institution-2',
      seed: alternateSeed,
    });

    const originalItems = await queryDiscipline(seed.discipline.id);
    const alternateItems = await queryDiscipline(
      alternateSeed.discipline.id,
    );

    expect(
      originalItems.every(
        (item) => item['institutionId'] === 'institution-1',
      ),
    ).toBe(true);
    expect(
      alternateItems.every(
        (item) => item['institutionId'] === 'institution-2',
      ),
    ).toBe(true);
  });
});
