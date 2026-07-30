import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { UserProfileRepository } from '@/application/ports/UserProfileRepository';
import type { UserProfile } from '@/domain/entities/UserProfile';

export class DynamoDbUserProfileRepository implements UserProfileRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findBySub(userId: string): Promise<UserProfile | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        // Padrão de acesso #1: decide autorização, precisa ser forte.
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return null;
    }

    return toUserProfile(result.Item);
  }

  async save(profile: UserProfile): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `USER#${profile.userId}`,
          SK: 'PROFILE',
          ...profile,
        },
      }),
    );
  }
}

function toUserProfile(item: Record<string, unknown>): UserProfile {
  return {
    userId: item['userId'] as string,
    institutionId: item['institutionId'] as string,
    role: item['role'] as UserProfile['role'],
    name: item['name'] as string,
    email: item['email'] as string,
    createdAt: item['createdAt'] as string,
    updatedAt: item['updatedAt'] as string,
  };
}
