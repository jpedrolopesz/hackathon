import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AttendanceRepository } from '@/application/ports/AttendanceRepository';
import type { Attendance } from '@/domain/entities/Attendance';

/**
 * PK=LIVE#{liveId}, SK=ATTENDANCE#{liveParticipantId} (padrão de acesso #12).
 * `markPresent` é upsert num só `UpdateItem` — `if_not_exists(joinedAt, :at)`
 * preserva a primeira entrada em reconexões, sem round-trip de leitura prévia.
 */
export class DynamoDbAttendanceRepository implements AttendanceRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async markPresent(
    liveId: string,
    liveParticipantId: string,
    userId: string,
    at: string,
  ): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `LIVE#${liveId}`, SK: `ATTENDANCE#${liveParticipantId}` },
        UpdateExpression:
          'SET liveId = :liveId, liveParticipantId = :participantId, userId = :userId, ' +
          'joinedAt = if_not_exists(joinedAt, :at), lastSeenAt = :at',
        ExpressionAttributeValues: {
          ':liveId': liveId,
          ':participantId': liveParticipantId,
          ':userId': userId,
          ':at': at,
        },
      }),
    );
  }

  async markLeft(liveId: string, liveParticipantId: string, at: string): Promise<void> {
    await this.client
      .send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `LIVE#${liveId}`, SK: `ATTENDANCE#${liveParticipantId}` },
          UpdateExpression: 'SET leftAt = :at, lastSeenAt = :at',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':at': at },
        }),
      )
      .catch((error: unknown) => {
        // Best-effort: um $disconnect sem markPresent prévio (cenário de borda) não
        // deve quebrar o fluxo de desconexão.
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          return;
        }
        throw error;
      });
  }

  async listByLive(liveId: string): Promise<readonly Attendance[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LIVE#${liveId}`, ':prefix': 'ATTENDANCE#' },
      }),
    );
    return (result.Items ?? []).map(toAttendance);
  }
}

function toAttendance(item: Record<string, unknown>): Attendance {
  const base: Attendance = {
    liveId: item['liveId'] as string,
    liveParticipantId: item['liveParticipantId'] as string,
    userId: item['userId'] as string,
    joinedAt: item['joinedAt'] as string,
    lastSeenAt: item['lastSeenAt'] as string,
  };
  const leftAt = item['leftAt'] as string | undefined;
  return { ...base, ...(leftAt !== undefined ? { leftAt } : {}) };
}
