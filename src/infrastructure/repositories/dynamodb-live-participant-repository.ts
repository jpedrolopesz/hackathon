import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { LiveParticipantRepository } from '@/application/ports/LiveParticipantRepository';
import type { LiveParticipant } from '@/domain/entities/LiveParticipant';

export class DynamoDbLiveParticipantRepository implements LiveParticipantRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async find(liveId: string, liveParticipantId: string): Promise<LiveParticipant | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `LIVE#${liveId}`, SK: `PARTICIPANT#${liveParticipantId}` },
        ConsistentRead: true,
      }),
    );

    return result.Item ? toLiveParticipant(result.Item) : null;
  }

  async findByUser(liveId: string, userId: string): Promise<LiveParticipant | null> {
    // A partição de uma live é pequena (limitada pelo tamanho da turma) — filtrar por
    // userId aqui é aceitável e não justifica um GSI dedicado só para isso.
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':pk': `LIVE#${liveId}`,
          ':prefix': 'PARTICIPANT#',
          ':userId': userId,
        },
      }),
    );

    const item = result.Items?.[0];
    return item ? toLiveParticipant(item) : null;
  }

  /** Seção 13 do README — "visualizar participantes" no painel. */
  async listByLive(liveId: string): Promise<readonly LiveParticipant[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LIVE#${liveId}`, ':prefix': 'PARTICIPANT#' },
      }),
    );

    return (result.Items ?? []).map(toLiveParticipant);
  }

  async save(participant: LiveParticipant): Promise<void> {
    const isPresenter = participant.capabilities.includes('PUBLISH');

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `LIVE#${participant.liveId}`,
          SK: `PARTICIPANT#${participant.liveParticipantId}`,
          ...participant,
          // GSI3 esparso (apresentadores ativos): PutCommand substitui o item inteiro,
          // então omitir a chave aqui é o que remove a entrada do índice quando o
          // participante é rebaixado — não precisa de um UpdateItem/REMOVE separado.
          ...(isPresenter
            ? {
                GSI3PK: `LIVE#${participant.liveId}#PRESENTERS`,
                GSI3SK: `PARTICIPANT#${participant.liveParticipantId}`,
              }
            : {}),
        },
      }),
    );
  }
}

function toLiveParticipant(item: Record<string, unknown>): LiveParticipant {
  const base: LiveParticipant = {
    liveParticipantId: item['liveParticipantId'] as string,
    liveId: item['liveId'] as string,
    userId: item['userId'] as string,
    role: item['role'] as LiveParticipant['role'],
    capabilities: item['capabilities'] as LiveParticipant['capabilities'],
    joinedAt: item['joinedAt'] as string,
  };

  const ivsParticipantId = item['ivsParticipantId'] as string | undefined;
  const promotedAt = item['promotedAt'] as string | undefined;

  return {
    ...base,
    ...(ivsParticipantId !== undefined ? { ivsParticipantId } : {}),
    ...(promotedAt !== undefined ? { promotedAt } : {}),
  };
}
