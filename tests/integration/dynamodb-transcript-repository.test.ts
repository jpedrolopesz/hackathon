import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Transcript } from '@/domain/entities/Transcript';
import type { TranscriptSegment } from '@/domain/entities/TranscriptSegment';
import { DynamoDbTranscriptRepository } from '@/infrastructure/repositories/dynamodb-transcript-repository';
import {
  launchDynamoDbLocal,
  stopDynamoDbLocal,
} from './support/dynamodb-local';

const PORT = 8211;
const TABLE_NAME = 'test-core-table-transcript';

let rawClient: DynamoDBClient;
let documentClient: DynamoDBDocumentClient;
let repository: DynamoDbTranscriptRepository;

function buildTranscript(
  overrides: Partial<Transcript> = {},
): Transcript {
  return {
    id: 'transcript-int-1',
    institutionId: 'institution-1',
    liveSessionId: 'live-int-1',
    recordingId: 'recording-int-1',
    disciplineId: 'discipline-statistics',
    language: 'pt-BR',
    consentRef: 'consent-int-1',
    status: 'PENDING',
    createdAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

function buildSegment(
  id: string,
  startMs: number,
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return {
    id,
    transcriptId: 'transcript-int-segments',
    institutionId: 'institution-1',
    speakerLabel: 'spk_0',
    speakerRole: 'PROFESSOR',
    startMs,
    endMs: startMs + 500,
    text: `Segmento fictício ${id}.`,
    consentRef: 'consent-int-segments',
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

  documentClient = DynamoDBDocumentClient.from(rawClient);
  repository = new DynamoDbTranscriptRepository(
    documentClient,
    TABLE_NAME,
  );
}, 30_000);

afterAll(async () => {
  await rawClient
    .send(new DeleteTableCommand({ TableName: TABLE_NAME }))
    .catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

describe('DynamoDbTranscriptRepository', () => {
  it('saves and finds a transcript with every domain field', async () => {
    const transcript = buildTranscript();

    await repository.save(transcript);

    await expect(
      repository.findByRecordingId('institution-1', 'recording-int-1'),
    ).resolves.toEqual(transcript);
  });

  it('returns null when the transcript belongs to another institution', async () => {
    await repository.save(
      buildTranscript({
        id: 'transcript-int-foreign',
        institutionId: 'institution-2',
        recordingId: 'recording-int-foreign',
      }),
    );

    await expect(
      repository.findByRecordingId(
        'institution-1',
        'recording-int-foreign',
      ),
    ).resolves.toBeNull();
  });

  it('persists more than 25 segments using multiple batches', async () => {
    const segments = Array.from({ length: 26 }, (_, index) =>
      buildSegment(`segment-batch-${index}`, index * 1_000, {
        transcriptId: 'transcript-int-batch',
      }),
    );

    await repository.saveSegments(segments);

    const result = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': 'TRANSCRIPT#transcript-int-batch',
        },
      }),
    );
    expect(result.Items).toHaveLength(26);
  });

  it('stores segments in increasing startMs order across different magnitudes', async () => {
    await repository.saveSegments([
      buildSegment('segment-60000', 60_000, {
        transcriptId: 'transcript-int-order',
      }),
      buildSegment('segment-900', 900, {
        transcriptId: 'transcript-int-order',
      }),
      buildSegment('segment-1000', 1_000, {
        transcriptId: 'transcript-int-order',
      }),
    ]);

    const result = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': 'TRANSCRIPT#transcript-int-order',
        },
        ScanIndexForward: true,
      }),
    );

    expect(result.Items?.map((item) => item['startMs'])).toEqual([
      900, 1_000, 60_000,
    ]);
    expect(result.Items?.map((item) => item['SK'])).toEqual([
      'SEGMENT#000000000900#segment-900',
      'SEGMENT#000000001000#segment-1000',
      'SEGMENT#000000060000#segment-60000',
    ]);
  });

  it('updates status and records a failure reason', async () => {
    await repository.save(
      buildTranscript({
        id: 'transcript-int-update',
        recordingId: 'recording-int-update',
      }),
    );

    await repository.updateStatus(
      'institution-1',
      'recording-int-update',
      'FAILED',
      'Falha fictícia de transcrição.',
    );

    await expect(
      repository.findByRecordingId('institution-1', 'recording-int-update'),
    ).resolves.toMatchObject({ status: 'FAILED' });
    const stored = await documentClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: 'RECORDING#recording-int-update',
          SK: 'TRANSCRIPT',
        },
      }),
    );
    expect(stored.Item?.['failureReason']).toBe(
      'Falha fictícia de transcrição.',
    );
  });

  it('rejects updateStatus for a recording that does not exist', async () => {
    await expect(
      repository.updateStatus(
        'institution-1',
        'recording-int-missing',
        'FAILED',
        'Falha fictícia.',
      ),
    ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
  });
});
