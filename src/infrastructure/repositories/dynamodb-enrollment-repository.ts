import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { EnrollmentRepository } from '@/application/ports/EnrollmentRepository';
import type { Enrollment } from '@/domain/entities/Enrollment';

export class DynamoDbEnrollmentRepository implements EnrollmentRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async find(studentId: string, classId: string): Promise<Enrollment | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${studentId}`, SK: `ENROLLMENT#${classId}` },
        // Padrão de acesso #8: gate de autorização do fluxo de join, precisa ser forte.
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return null;
    }

    return toEnrollment(result.Item);
  }

  async listByStudent(studentId: string): Promise<readonly Enrollment[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${studentId}`,
          ':prefix': 'ENROLLMENT#',
        },
      }),
    );

    return (result.Items ?? []).map(toEnrollment);
  }

  async save(enrollment: Enrollment): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `USER#${enrollment.studentId}`,
          SK: `ENROLLMENT#${enrollment.classId}`,
          ...enrollment,
        },
      }),
    );
  }

  async cancel(studentId: string, classId: string): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${studentId}`, SK: `ENROLLMENT#${classId}` },
        UpdateExpression: 'SET #status = :canceled',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':canceled': 'CANCELED' },
      }),
    );
  }
}

function toEnrollment(item: Record<string, unknown>): Enrollment {
  return {
    studentId: item['studentId'] as string,
    classId: item['classId'] as string,
    courseId: item['courseId'] as string,
    institutionId: item['institutionId'] as string,
    courseName: item['courseName'] as string,
    className: item['className'] as string,
    enrolledAt: item['enrolledAt'] as string,
    status: item['status'] as Enrollment['status'],
  };
}
