import 'server-only';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ClassGroupRepository } from '@/application/ports/ClassGroupRepository';
import type { ClassGroup } from '@/domain/entities/ClassGroup';

export class DynamoDbClassGroupRepository implements ClassGroupRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findById(classId: string): Promise<ClassGroup | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `CLASS#${classId}`, SK: 'METADATA' },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return null;
    }

    return toClassGroup(result.Item);
  }

  async save(classGroup: ClassGroup): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `CLASS#${classGroup.classId}`,
          SK: 'METADATA',
          // Padrão de acesso #3 (turmas de um professor).
          GSI1PK: `TEACHER#${classGroup.teacherId}`,
          GSI1SK: `CLASS#${classGroup.classId}`,
          ...classGroup,
        },
      }),
    );
  }
}

function toClassGroup(item: Record<string, unknown>): ClassGroup {
  return {
    classId: item['classId'] as string,
    courseId: item['courseId'] as string,
    institutionId: item['institutionId'] as string,
    teacherId: item['teacherId'] as string,
    name: item['name'] as string,
    createdAt: item['createdAt'] as string,
  };
}
