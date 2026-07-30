import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConflictError } from '@/domain/errors/ConflictError';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { LiveStatus } from '@/domain/value-objects/LiveStatus';

export class DynamoDbLiveSessionRepository implements LiveSessionRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findById(liveId: string): Promise<LiveSession | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `LIVE#${liveId}`, SK: 'METADATA' },
        // Padrão de acesso #6: start/finish idempotentes dependem de leitura forte.
        ConsistentRead: true,
      }),
    );

    return result.Item ? toLiveSession(result.Item) : null;
  }

  async findByStageArn(stageArn: string): Promise<LiveSession | null> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `STAGE#${stageArn}` },
        Limit: 1,
      }),
    );

    const item = result.Items?.[0];
    return item ? toLiveSession(item) : null;
  }

  /** Padrão de acesso #4 do README — lives de uma turma, ordenadas por horário (GSI1). */
  async listByClass(classId: string): Promise<readonly LiveSession[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `CLASS#${classId}` },
      }),
    );

    return (result.Items ?? []).map(toLiveSession);
  }

  async create(live: LiveSession): Promise<void> {
    await this.client
      .send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `LIVE#${live.liveId}`,
            SK: 'METADATA',
            // Padrão de acesso #4 — lives de uma turma, ordenadas por horário.
            GSI1PK: `CLASS#${live.classId}`,
            GSI1SK: `${live.scheduledStartAt}#${live.liveId}`,
            ...live,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      )
      .catch(rethrowConditionalCheckAsConflict(`LiveSession ${live.liveId} already exists`));
  }

  async transitionStatus(
    liveId: string,
    expectedStatus: LiveStatus,
    nextStatus: LiveStatus,
  ): Promise<void> {
    await this.client
      .send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `LIVE#${liveId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #status = :next, updatedAt = :now',
          ConditionExpression: '#status = :expected',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':next': nextStatus,
            ':expected': expectedStatus,
            ':now': new Date().toISOString(),
          },
        }),
      )
      .catch(
        rethrowConditionalCheckAsConflict(
          `LiveSession ${liveId} transition ${expectedStatus} -> ${nextStatus} failed: current status was not ${expectedStatus}`,
        ),
      );
  }

  async attachStage(liveId: string, expectedStatus: LiveStatus, stageArn: string): Promise<void> {
    await this.client
      .send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `LIVE#${liveId}`, SK: 'METADATA' },
          UpdateExpression:
            'SET stageArn = :stageArn, GSI2PK = :stageKey, GSI2SK = :stageKey, updatedAt = :now',
          ConditionExpression: '#status = :expected AND attribute_not_exists(stageArn)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':stageArn': stageArn,
            ':stageKey': `STAGE#${stageArn}`,
            ':expected': expectedStatus,
            ':now': new Date().toISOString(),
          },
        }),
      )
      .catch(
        rethrowConditionalCheckAsConflict(
          `LiveSession ${liveId} attachStage failed: status was not ${expectedStatus} or stageArn was already set`,
        ),
      );
  }

  async updateDetails(
    liveId: string,
    details: {
      readonly title: string;
      readonly description?: string;
      readonly scheduledStartAt: string;
      readonly scheduledDurationMinutes?: number;
    },
  ): Promise<void> {
    const setClause =
      'SET title = :title, scheduledStartAt = :scheduledStartAt, updatedAt = :now, GSI1SK = :gsi1sk' +
      (details.scheduledDurationMinutes !== undefined
        ? ', scheduledDurationMinutes = :scheduledDurationMinutes'
        : '');
    const updateExpression =
      details.description !== undefined
        ? `${setClause}, description = :description`
        : `${setClause} REMOVE description`;

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `LIVE#${liveId}`, SK: 'METADATA' },
        UpdateExpression: updateExpression,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: {
          ':title': details.title,
          ':scheduledStartAt': details.scheduledStartAt,
          ':gsi1sk': `${details.scheduledStartAt}#${liveId}`,
          ':now': new Date().toISOString(),
          ...(details.description !== undefined ? { ':description': details.description } : {}),
          ...(details.scheduledDurationMinutes !== undefined
            ? { ':scheduledDurationMinutes': details.scheduledDurationMinutes }
            : {}),
        },
      }),
    );
  }

  async claimActiveRecording(
    liveId: string,
    expectedCurrentRecordingId: string | undefined,
    newRecordingId: string,
  ): Promise<void> {
    await this.client
      .send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `LIVE#${liveId}`, SK: 'METADATA' },
          UpdateExpression: 'SET activeRecordingId = :next, updatedAt = :now',
          ConditionExpression:
            expectedCurrentRecordingId === undefined
              ? 'attribute_not_exists(activeRecordingId)'
              : 'activeRecordingId = :expected',
          ExpressionAttributeValues: {
            ':next': newRecordingId,
            ':now': new Date().toISOString(),
            ...(expectedCurrentRecordingId !== undefined
              ? { ':expected': expectedCurrentRecordingId }
              : {}),
          },
        }),
      )
      .catch(
        rethrowConditionalCheckAsConflict(
          `LiveSession ${liveId} claimActiveRecording failed: activeRecordingId was not ${expectedCurrentRecordingId ?? 'absent'}`,
        ),
      );
  }

  async clearActiveRecording(liveId: string, expectedRecordingId: string): Promise<void> {
    await this.client
      .send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `LIVE#${liveId}`, SK: 'METADATA' },
          UpdateExpression: 'REMOVE activeRecordingId SET updatedAt = :now',
          ConditionExpression: 'activeRecordingId = :expected',
          ExpressionAttributeValues: {
            ':expected': expectedRecordingId,
            ':now': new Date().toISOString(),
          },
        }),
      )
      .catch((error: unknown) => {
        // Best-effort: se já foi substituída por outra gravação (ou já limpa), não é
        // um erro — não queremos apagar o rastro de uma gravação mais nova.
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          return;
        }
        throw error;
      });
  }
}

function rethrowConditionalCheckAsConflict(internalMessage: string) {
  return (error: unknown): never => {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      throw new ConflictError(
        'Não foi possível concluir a operação porque o estado da aula mudou. Tente novamente.',
        'CONFLICT',
        internalMessage,
      );
    }
    throw error;
  };
}

function toLiveSession(item: Record<string, unknown>): LiveSession {
  const base: LiveSession = {
    liveId: item['liveId'] as string,
    classId: item['classId'] as string,
    institutionId: item['institutionId'] as string,
    teacherId: item['teacherId'] as string,
    title: item['title'] as string,
    scheduledStartAt: item['scheduledStartAt'] as string,
    status: item['status'] as LiveStatus,
    createdAt: item['createdAt'] as string,
    updatedAt: item['updatedAt'] as string,
  };

  const stageArn = item['stageArn'] as string | undefined;
  const activeRecordingId = item['activeRecordingId'] as string | undefined;
  const description = item['description'] as string | undefined;
  const scheduledDurationMinutes = item['scheduledDurationMinutes'] as number | undefined;

  return {
    ...base,
    ...(stageArn !== undefined ? { stageArn } : {}),
    ...(activeRecordingId !== undefined ? { activeRecordingId } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(scheduledDurationMinutes !== undefined ? { scheduledDurationMinutes } : {}),
  };
}
