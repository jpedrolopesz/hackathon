import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { GraphRepository } from '@/application/ports/GraphRepository';
import type { GraphEdge } from '@/domain/entities/GraphEdge';

/**
 * Acesso institucional por disciplina: uma Query em PK=DISC#{disciplineId}
 * restrita ao prefixo EDGE#PREREQUISITE_OF#. O repositório também valida
 * institutionId em cada item antes de materializar a aresta.
 */
export class DynamoDbGraphRepository implements GraphRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findPrerequisiteEdges(
    institutionId: string,
    disciplineId: string,
  ): Promise<readonly GraphEdge[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `DISC#${disciplineId}`,
          ':prefix': 'EDGE#PREREQUISITE_OF#',
        },
      }),
    );

    return (result.Items ?? [])
      .filter((item) => item['institutionId'] === institutionId)
      .map(toGraphEdge);
  }
}

function toGraphEdge(item: Record<string, unknown>): GraphEdge {
  return {
    id: item['id'] as string,
    institutionId: item['institutionId'] as string,
    disciplineId: item['disciplineId'] as string,
    type: item['type'] as GraphEdge['type'],
    fromNodeId: item['fromNodeId'] as string,
    toNodeId: item['toNodeId'] as string,
    evidenceKind: item['evidenceKind'] as GraphEdge['evidenceKind'],
  };
}
