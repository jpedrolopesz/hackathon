import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { CourseRepository } from '@/application/ports/CourseRepository';
import type { Course } from '@/domain/entities/Course';

export class DynamoDbCourseRepository implements CourseRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findById(courseId: string): Promise<Course | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `COURSE#${courseId}`, SK: 'METADATA' },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return null;
    }

    return toCourse(result.Item);
  }

  async save(course: Course): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `COURSE#${course.courseId}`,
          SK: 'METADATA',
          ...course,
        },
      }),
    );
  }
}

function toCourse(item: Record<string, unknown>): Course {
  return {
    courseId: item['courseId'] as string,
    institutionId: item['institutionId'] as string,
    name: item['name'] as string,
    createdAt: item['createdAt'] as string,
  };
}
