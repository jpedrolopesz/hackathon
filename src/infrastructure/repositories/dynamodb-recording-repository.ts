import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  ApplyRecordingEventResult,
  RecordingEventPatch,
  RecordingPage,
  RecordingRepository,
} from '@/application/ports/RecordingRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { Recording } from '@/domain/entities/Recording';
import type { RecordingStatus } from '@/domain/value-objects/RecordingStatus';

/**
 * PK=COURSE#{courseId}, SK=RECORDING#{startedAt}#{recordingId} (padrão de acesso #9).
 * GSI2PK=RECORDING#{recordingId} para lookup direto por ID — quem só tem o
 * `recordingId` (o consumidor de EventBridge, as rotas de publish/hide/playback) não
 * sabe `courseId`/`startedAt` de antemão, então toda operação por ID faz Query no
 * GSI2 primeiro para resolver a chave real da tabela base, e só então o UpdateItem
 * condicional (GSI nunca aceita update direto).
 */
export class DynamoDbRecordingRepository implements RecordingRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(recording: Recording): Promise<void> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `COURSE#${recording.courseId}`,
            SK: `RECORDING#${recording.startedAt}#${recording.recordingId}`,
            GSI2PK: `RECORDING#${recording.recordingId}`,
            GSI2SK: `RECORDING#${recording.recordingId}`,
            ...recording,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return; // create é chamado só uma vez por recordingId (gerado por nós); um
        // reenvio idempotente (ex. retry do próprio consumidor) não deve lançar.
      }
      throw error;
    }
  }

  async findById(recordingId: string): Promise<Recording | null> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `RECORDING#${recordingId}` },
        Limit: 1,
      }),
    );
    const item = result.Items?.[0];
    return item ? toRecording(item) : null;
  }

  async findByCourse(courseId: string, pageSize: number, cursor?: string): Promise<RecordingPage> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `COURSE#${courseId}`, ':prefix': 'RECORDING#' },
        ScanIndexForward: false,
        Limit: pageSize,
        ExclusiveStartKey: cursor ? decodeCursor(cursor) : undefined,
      }),
    );

    const recordings = (result.Items ?? []).map(toRecording);
    return result.LastEvaluatedKey
      ? { recordings, nextCursor: encodeCursor(result.LastEvaluatedKey) }
      : { recordings };
  }

  async applyEvent(
    recordingId: string,
    eventTimeIso: string,
    expectedFromStatuses: readonly RecordingStatus[],
    patch: RecordingEventPatch,
  ): Promise<ApplyRecordingEventResult> {
    const key = await this.resolveBaseKey(recordingId);
    if (!key) {
      return 'not_found';
    }

    const patchEntries = Object.entries(patch).filter(([, value]) => value !== undefined);
    const setClauses = ['lastEventTime = :eventTime', ...patchEntries.map(([field]) => `#${field} = :${field}`)];
    const expressionAttributeNames: Record<string, string> = Object.fromEntries(
      patchEntries.map(([field]) => [`#${field}`, field]),
    );
    const expressionAttributeValues: Record<string, unknown> = {
      ':eventTime': eventTimeIso,
      ...Object.fromEntries(patchEntries.map(([field, value]) => [`:${field}`, value])),
      ...Object.fromEntries(expectedFromStatuses.map((status, index) => [`:from${index}`, status])),
    };

    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key,
          UpdateExpression: `SET ${setClauses.join(', ')}`,
          ConditionExpression: `(attribute_not_exists(lastEventTime) OR lastEventTime < :eventTime) AND #status IN (${expectedFromStatuses.map((_, index) => `:from${index}`).join(', ')})`,
          ExpressionAttributeNames: { ...expressionAttributeNames, '#status': 'status' },
          ExpressionAttributeValues: expressionAttributeValues,
        }),
      );
      return 'applied';
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return 'stale';
      }
      throw error;
    }
  }

  async publish(recordingId: string): Promise<void> {
    const key = await this.resolveBaseKey(recordingId);
    if (!key) {
      throw new NotFoundError(
        'Gravação não encontrada.',
        'RECORDING_NOT_FOUND',
        `Recording ${recordingId} not found for publish`,
      );
    }
    await this.client
      .send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key,
          UpdateExpression: 'SET visibility = :published',
          ConditionExpression: '#status = :ready',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':published': 'PUBLISHED', ':ready': 'READY' },
        }),
      )
      .catch(rethrowConditionalCheckAsConflict(recordingId, 'publish'));
  }

  async hide(recordingId: string): Promise<void> {
    const key = await this.resolveBaseKey(recordingId);
    if (!key) {
      throw new NotFoundError(
        'Gravação não encontrada.',
        'RECORDING_NOT_FOUND',
        `Recording ${recordingId} not found for hide`,
      );
    }
    await this.client
      .send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key,
          UpdateExpression: 'SET #status = :hidden',
          ConditionExpression: '#status = :ready',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':hidden': 'HIDDEN', ':ready': 'READY' },
        }),
      )
      .catch(rethrowConditionalCheckAsConflict(recordingId, 'hide'));
  }

  /** GSI2 não aceita GetItem (só Query/Scan) — por isso a resolução de
   * `recordingId` → PK/SK da tabela base é sempre uma Query. */
  private async resolveBaseKey(
    recordingId: string,
  ): Promise<{ PK: string; SK: string } | null> {
    const query = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `RECORDING#${recordingId}` },
        Limit: 1,
      }),
    );
    const item = query.Items?.[0];
    if (!item) return null;
    return { PK: item['PK'] as string, SK: item['SK'] as string };
  }
}

function rethrowConditionalCheckAsConflict(recordingId: string, action: string) {
  return (error: unknown): never => {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      throw new ConflictError(
        'Esta gravação não está pronta para essa ação.',
        'RECORDING_NOT_READY',
        `Recording ${recordingId} is not READY, cannot ${action}`,
      );
    }
    throw error;
  };
}

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf-8').toString('base64url');
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as Record<string, unknown>;
}

function toRecording(item: Record<string, unknown>): Recording {
  const base: Recording = {
    recordingId: item['recordingId'] as string,
    liveId: item['liveId'] as string,
    courseId: item['courseId'] as string,
    institutionId: item['institutionId'] as string,
    stageArn: item['stageArn'] as string,
    status: item['status'] as Recording['status'],
    startedAt: item['startedAt'] as string,
    visibility: item['visibility'] as Recording['visibility'],
  };
  const optionalFields: Array<keyof Recording> = [
    'compositionArn',
    's3Prefix',
    'manifestPath',
    'cloudFrontPath',
    'durationSeconds',
    'endedAt',
    'errorMessage',
    'lastEventTime',
  ];
  const optional: Partial<Recording> = {};
  for (const field of optionalFields) {
    const value = item[field];
    if (value !== undefined) {
      Object.assign(optional, { [field]: value });
    }
  }
  return { ...base, ...optional };
}
