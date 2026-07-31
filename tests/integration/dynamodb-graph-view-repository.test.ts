import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import seedPayload from '../../seeds/estatistica-i.json';
import { DynamoDbGraphViewRepository } from '@/infrastructure/repositories/dynamodb-graph-view-repository';
import { loadGraphSeed } from '@/infrastructure/seed/load-graph-seed';
import { parseGraphSeed } from '@/infrastructure/seed/graph-seed-schema';
import {
  launchDynamoDbLocal,
  stopDynamoDbLocal,
} from './support/dynamodb-local';

const PORT = 8214;
const TABLE_NAME = 'test-core-table-graph-view-repository';
const INSTITUTION_ID = 'institution-1';
const DISCIPLINE_ID = 'discipline-statistics';
const USER_ID = 'user-fictional-1';

let rawClient: DynamoDBClient;
let documentClient: DynamoDBDocumentClient;
let repository: DynamoDbGraphViewRepository;

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
  await loadGraphSeed(documentClient, TABLE_NAME, {
    institutionId: INSTITUTION_ID,
    seed: parseGraphSeed(seedPayload),
  });
  await writeOverlay();
  repository = new DynamoDbGraphViewRepository(documentClient, TABLE_NAME);
}, 30_000);

afterAll(async () => {
  await rawClient
    .send(new DeleteTableCommand({ TableName: TABLE_NAME }))
    .catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

describe('DynamoDbGraphViewRepository', () => {
  it('returns the complete institutional graph from one partition', async () => {
    const graph = await repository.findInstitutionalGraph(
      INSTITUTION_ID,
      DISCIPLINE_ID,
    );

    expect(graph.discipline).toEqual(
      expect.objectContaining({
        id: DISCIPLINE_ID,
        name: 'Estatística I',
      }),
    );
    expect(graph.nodes.filter((node) => node.type === 'MODULE')).toHaveLength(4);
    expect(graph.nodes.filter((node) => node.type === 'CONCEPT')).toHaveLength(
      15,
    );
    expect(graph.nodes.filter((node) => node.type === 'MATERIAL')).toHaveLength(
      4,
    );
    expect(graph.edges).toHaveLength(41);
  });

  it('does not turn MATERIAL items into duplicate graph nodes', async () => {
    const graph = await repository.findInstitutionalGraph(
      INSTITUTION_ID,
      DISCIPLINE_ID,
    );
    const materialNodes = graph.nodes.filter(
      (node) => node.type === 'MATERIAL',
    );

    expect(materialNodes).toHaveLength(4);
    expect(new Set(materialNodes.map((node) => node.nodeId)).size).toBe(4);
  });

  it('returns an empty graph for another institution', async () => {
    await expect(
      repository.findInstitutionalGraph('institution-2', DISCIPLINE_ID),
    ).resolves.toEqual({
      discipline: null,
      nodes: [],
      edges: [],
    });
  });

  it('returns states, transcript evidences and detected questions', async () => {
    const overlay = await repository.findUserOverlay(
      INSTITUTION_ID,
      USER_ID,
      DISCIPLINE_ID,
    );

    expect(overlay.states).toHaveLength(1);
    expect(overlay.transcriptEvidences).toHaveLength(1);
    expect(overlay.transcriptEvidences[0]?.origin).toBe('TRANSCRIPT');
    expect(overlay.detectedQuestions).toHaveLength(1);
  });

  it('excludes ACCESS and ACTIVITY evidences from the overlay', async () => {
    const overlay = await repository.findUserOverlay(
      INSTITUTION_ID,
      USER_ID,
      DISCIPLINE_ID,
    );

    expect(overlay.transcriptEvidences).toHaveLength(1);
    expect(
      overlay.transcriptEvidences.some(
        (evidence) =>
          evidence.origin === 'ACCESS' || evidence.origin === 'ACTIVITY',
      ),
    ).toBe(false);
  });

  it('does not leak another user overlay', async () => {
    await documentClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: learningStateItem('user-fictional-2', 'concept-median'),
      }),
    );

    const overlay = await repository.findUserOverlay(
      INSTITUTION_ID,
      USER_ID,
      DISCIPLINE_ID,
    );

    expect(overlay.states).toHaveLength(1);
    expect(overlay.states.every((state) => state.userId === USER_ID)).toBe(true);
  });

  it('sends exactly one command for each repository method', async () => {
    const sendSpy = vi.spyOn(documentClient, 'send');

    await repository.findInstitutionalGraph(INSTITUTION_ID, DISCIPLINE_ID);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sendSpy.mockClear();
    await repository.findUserOverlay(INSTITUTION_ID, USER_ID, DISCIPLINE_ID);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sendSpy.mockRestore();
  });
});

async function writeOverlay(): Promise<void> {
  const partitionKey = `USER#${USER_ID}#DISC#${DISCIPLINE_ID}`;
  const common = {
    PK: partitionKey,
    institutionId: INSTITUTION_ID,
    userId: USER_ID,
    disciplineId: DISCIPLINE_ID,
  };
  const items = [
    {
      ...common,
      SK: 'STATE#concept-mean',
      conceptId: 'concept-mean',
      state: 'IN_PROGRESS',
      explanation: 'O conceito possui evidências recentes.',
      ruleVersion: 'state-rules/v1',
      evidenceIds: ['evidence-transcript-1'],
      computedAt: '2026-07-20T12:00:00.000Z',
    },
    {
      ...common,
      SK: 'EVIDENCE#evidence-transcript-1',
      id: 'evidence-transcript-1',
      conceptId: 'concept-mean',
      occurredAt: '2026-07-20T10:00:00.000Z',
      sourceRef: 'question-1',
      origin: 'TRANSCRIPT',
      consentRef: 'consent-fictional-1',
    },
    {
      ...common,
      SK: 'EVIDENCE#evidence-access-1',
      id: 'evidence-access-1',
      conceptId: 'concept-median',
      occurredAt: '2026-07-20T10:05:00.000Z',
      sourceRef: 'material-fictional-1',
      origin: 'ACCESS',
    },
    {
      ...common,
      SK: 'EVIDENCE#evidence-activity-1',
      id: 'evidence-activity-1',
      conceptId: 'concept-median',
      occurredAt: '2026-07-20T10:10:00.000Z',
      sourceRef: 'activity-fictional-1',
      origin: 'ACTIVITY',
      result: 'CORRECT',
    },
    {
      ...common,
      SK: 'DOUBT#question-1',
      id: 'question-1',
      transcriptId: 'transcript-fictional-1',
      segmentIds: ['segment-fictional-1'],
      summary: 'Diferença entre média e mediana',
      detectedAt: '2026-07-20T10:00:00.000Z',
      consentRef: 'consent-fictional-1',
    },
  ];

  await documentClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: items.map((item) => ({
          PutRequest: { Item: item },
        })),
      },
    }),
  );
}

function learningStateItem(
  userId: string,
  conceptId: string,
): Record<string, unknown> {
  return {
    PK: `USER#${userId}#DISC#${DISCIPLINE_ID}`,
    SK: `STATE#${conceptId}`,
    institutionId: INSTITUTION_ID,
    userId,
    disciplineId: DISCIPLINE_ID,
    conceptId,
    state: 'NOT_STARTED',
    explanation: 'Ainda não há evidência para o conceito.',
    ruleVersion: 'state-rules/v1',
    evidenceIds: [],
    computedAt: '2026-07-20T12:00:00.000Z',
  };
}
