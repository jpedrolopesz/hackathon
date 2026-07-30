import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { TranscriptRepository } from '@/application/ports/TranscriptRepository';
import type {
  Transcript,
  TranscriptStatus,
} from '@/domain/entities/Transcript';
import type { TranscriptSegment } from '@/domain/entities/TranscriptSegment';

type PutWriteRequest = {
  PutRequest: { Item: Record<string, unknown> };
};

const BATCH_WRITE_LIMIT = 25;

/**
 * Transcript: PK=RECORDING#{recordingId}, SK=TRANSCRIPT.
 * Segmento: PK=TRANSCRIPT#{transcriptId}, SK=SEGMENT#{startMs}#{segmentId}.
 * `startMs` usa padding fixo de 12 dígitos para preservar a ordem cronológica
 * na ordenação lexicográfica do DynamoDB (por exemplo, 900 antes de 1000).
 */
export class DynamoDbTranscriptRepository implements TranscriptRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findByRecordingId(
    institutionId: string,
    recordingId: string,
  ): Promise<Transcript | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `RECORDING#${recordingId}`,
          SK: 'TRANSCRIPT',
        },
      }),
    );

    const item = result.Item;
    if (!item || item['institutionId'] !== institutionId) {
      return null;
    }

    return toTranscript(item);
  }

  async save(transcript: Transcript): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `RECORDING#${transcript.recordingId}`,
          SK: 'TRANSCRIPT',
          id: transcript.id,
          institutionId: transcript.institutionId,
          liveSessionId: transcript.liveSessionId,
          recordingId: transcript.recordingId,
          disciplineId: transcript.disciplineId,
          language: transcript.language,
          consentRef: transcript.consentRef,
          status: transcript.status,
          createdAt: transcript.createdAt,
        },
      }),
    );
  }

  async saveSegments(
    segments: readonly TranscriptSegment[],
  ): Promise<void> {
    const requests: PutWriteRequest[] = segments.map((segment) => ({
      PutRequest: {
        Item: {
          PK: `TRANSCRIPT#${segment.transcriptId}`,
          SK: `SEGMENT#${segment.startMs.toString().padStart(12, '0')}#${segment.id}`,
          id: segment.id,
          transcriptId: segment.transcriptId,
          institutionId: segment.institutionId,
          speakerLabel: segment.speakerLabel,
          speakerRole: segment.speakerRole,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text: segment.text,
          consentRef: segment.consentRef,
        },
      },
    }));

    for (
      let offset = 0;
      offset < requests.length;
      offset += BATCH_WRITE_LIMIT
    ) {
      await this.writeBatchWithRetry(
        requests.slice(offset, offset + BATCH_WRITE_LIMIT),
      );
    }
  }

  async updateStatus(
    institutionId: string,
    recordingId: string,
    status: TranscriptStatus,
    failureReason?: string,
  ): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: `RECORDING#${recordingId}`,
          SK: 'TRANSCRIPT',
        },
        UpdateExpression:
          failureReason === undefined
            ? 'SET #status = :status'
            : 'SET #status = :status, failureReason = :failureReason',
        ConditionExpression:
          'attribute_exists(PK) AND institutionId = :institutionId',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':institutionId': institutionId,
          ...(failureReason === undefined
            ? {}
            : { ':failureReason': failureReason }),
        },
      }),
    );
  }

  private async writeBatchWithRetry(
    batch: readonly PutWriteRequest[],
  ): Promise<void> {
    let pending: readonly PutWriteRequest[] = batch;

    while (pending.length > 0) {
      const result = await this.client.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: [...pending],
          },
        }),
      );
      pending =
        (result.UnprocessedItems?.[
          this.tableName
        ] as PutWriteRequest[] | undefined) ?? [];
    }
  }
}

function toTranscript(item: Record<string, unknown>): Transcript {
  return {
    id: item['id'] as string,
    institutionId: item['institutionId'] as string,
    liveSessionId: item['liveSessionId'] as string,
    recordingId: item['recordingId'] as string,
    disciplineId: item['disciplineId'] as string,
    language: item['language'] as string,
    consentRef: item['consentRef'] as string,
    status: item['status'] as TranscriptStatus,
    createdAt: item['createdAt'] as string,
  };
}
