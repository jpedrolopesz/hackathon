import 'server-only';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { QuestionRepository } from '@/application/ports/QuestionRepository';
import type { Question } from '@/domain/entities/Question';

export class DynamoDbQuestionRepository implements QuestionRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(question: Question): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `LIVE#${question.liveId}`,
          SK: `QUESTION#${question.createdAt}#${question.questionId}`,
          ...question,
        },
      }),
    );
  }

  async find(liveId: string, questionId: string): Promise<Question | null> {
    // Perguntas não têm um GetItem direto (a SK inclui createdAt) — a partição de uma
    // live é pequena, então uma Query filtrada é aceitável (mesmo raciocínio já usado
    // em findByUser de LiveParticipant/Enrollment).
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'questionId = :questionId',
        ExpressionAttributeValues: {
          ':pk': `LIVE#${liveId}`,
          ':prefix': 'QUESTION#',
          ':questionId': questionId,
        },
      }),
    );
    const item = result.Items?.[0];
    return item ? toQuestion(item) : null;
  }

  async listByLive(liveId: string): Promise<readonly Question[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LIVE#${liveId}`, ':prefix': 'QUESTION#' },
      }),
    );
    return (result.Items ?? []).map(toQuestion);
  }
}

function toQuestion(item: Record<string, unknown>): Question {
  const base: Question = {
    questionId: item['questionId'] as string,
    liveId: item['liveId'] as string,
    authorLiveParticipantId: item['authorLiveParticipantId'] as string,
    body: item['body'] as string,
    status: item['status'] as Question['status'],
    createdAt: item['createdAt'] as string,
  };
  const answeredAt = item['answeredAt'] as string | undefined;
  return { ...base, ...(answeredAt !== undefined ? { answeredAt } : {}) };
}
