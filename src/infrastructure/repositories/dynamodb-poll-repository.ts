import 'server-only';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { PollRepository } from '@/application/ports/PollRepository';
import type { Poll } from '@/domain/entities/Poll';
import type { PollVote } from '@/domain/entities/PollVote';

export class DynamoDbPollRepository implements PollRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(poll: Poll): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: `LIVE#${poll.liveId}`, SK: `POLL#${poll.pollId}`, ...poll },
      }),
    );
  }

  async find(liveId: string, pollId: string): Promise<Poll | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `LIVE#${liveId}`, SK: `POLL#${pollId}` },
        ConsistentRead: true,
      }),
    );
    return result.Item ? toPoll(result.Item) : null;
  }

  async listByLive(liveId: string): Promise<readonly Poll[]> {
    // `begins_with(SK, 'POLL#')` não colide com `POLLVOTE#...` — o quinto caractere
    // diverge ('#' vs 'V'), então begins_with não casa um prefixo do outro.
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LIVE#${liveId}`, ':prefix': 'POLL#' },
      }),
    );
    return (result.Items ?? []).map(toPoll);
  }

  async saveVote(vote: PollVote): Promise<void> {
    // PutItem sobrescreve — um aluno votando de novo na mesma enquete troca de opção
    // em vez de contar dois votos (chave é PK+SK, não inclui a opção escolhida).
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `LIVE#${vote.liveId}`,
          SK: `POLLVOTE#${vote.pollId}#${vote.liveParticipantId}`,
          ...vote,
        },
      }),
    );
  }

  async listVotes(liveId: string, pollId: string): Promise<readonly PollVote[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LIVE#${liveId}`, ':prefix': `POLLVOTE#${pollId}#` },
      }),
    );
    return (result.Items ?? []).map(toPollVote);
  }
}

function toPoll(item: Record<string, unknown>): Poll {
  const base: Poll = {
    pollId: item['pollId'] as string,
    liveId: item['liveId'] as string,
    question: item['question'] as string,
    options: item['options'] as Poll['options'],
    status: item['status'] as Poll['status'],
    createdAt: item['createdAt'] as string,
  };
  const closedAt = item['closedAt'] as string | undefined;
  return { ...base, ...(closedAt !== undefined ? { closedAt } : {}) };
}

function toPollVote(item: Record<string, unknown>): PollVote {
  return {
    pollId: item['pollId'] as string,
    liveId: item['liveId'] as string,
    liveParticipantId: item['liveParticipantId'] as string,
    optionId: item['optionId'] as string,
    votedAt: item['votedAt'] as string,
  };
}
