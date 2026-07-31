import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  GraphViewRepository,
  InstitutionalGraph,
  UserGraphOverlay,
} from '@/application/ports/GraphViewRepository';
import type { DetectedQuestion } from '@/domain/entities/DetectedQuestion';
import type { Discipline } from '@/domain/entities/Discipline';
import type { GraphEdge } from '@/domain/entities/GraphEdge';
import type { GraphNode, GraphNodeType } from '@/domain/entities/GraphNode';
import type { LearningEvidence } from '@/domain/entities/LearningEvidence';
import type { LearningState } from '@/domain/entities/LearningState';

/**
 * Cada método consome exatamente uma Query, totalizando as duas leituras do
 * Graph View, e nunca usa Scan. Não há paginação por LastEvaluatedKey nesta
 * etapa: uma resposta truncada exige revisão do modelo de acesso.
 */
export class DynamoDbGraphViewRepository implements GraphViewRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findInstitutionalGraph(
    institutionId: string,
    disciplineId: string,
  ): Promise<InstitutionalGraph> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `DISC#${disciplineId}`,
        },
      }),
    );
    const items = (result.Items ?? []).filter(
      (item) => item['institutionId'] === institutionId,
    );
    const disciplineItem = items.find((item) => item['SK'] === 'METADATA');

    if (disciplineItem === undefined) {
      return { discipline: null, nodes: [], edges: [] };
    }

    return {
      discipline: toDiscipline(disciplineItem),
      nodes: items
        .filter(
          (item) =>
            String(item['SK']).startsWith('NODE#') &&
            isGraphNodeType(item['type']),
        )
        .map(toGraphNode),
      edges: items
        .filter((item) => String(item['SK']).startsWith('EDGE#'))
        .map(toGraphEdge),
    };
  }

  async findUserOverlay(
    institutionId: string,
    userId: string,
    disciplineId: string,
  ): Promise<UserGraphOverlay> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}#DISC#${disciplineId}`,
        },
      }),
    );
    const items = (result.Items ?? []).filter(
      (item) => item['institutionId'] === institutionId,
    );

    return {
      states: items
        .filter((item) => String(item['SK']).startsWith('STATE#'))
        .map(toLearningState),
      transcriptEvidences: items
        .filter(
          (item) =>
            String(item['SK']).startsWith('EVIDENCE#') &&
            item['origin'] === 'TRANSCRIPT',
        )
        .map(toTranscriptLearningEvidence),
      detectedQuestions: items
        .filter((item) => String(item['SK']).startsWith('DOUBT#'))
        .map(toDetectedQuestion),
    };
  }
}

function toDiscipline(item: Record<string, unknown>): Discipline {
  return {
    id: item['id'] as string,
    institutionId: item['institutionId'] as string,
    courseId: item['courseId'] as string,
    name: item['name'] as string,
    semester: item['semester'] as string,
    createdAt: item['createdAt'] as string,
  };
}

function isGraphNodeType(value: unknown): value is GraphNodeType {
  return value === 'CONCEPT' || value === 'MODULE' || value === 'MATERIAL';
}

function toGraphNode(item: Record<string, unknown>): GraphNode {
  const base = {
    nodeId: item['nodeId'] as string,
    institutionId: item['institutionId'] as string,
    disciplineId: item['disciplineId'] as string,
    title: item['title'] as string,
  };

  if (item['type'] === 'MATERIAL') {
    return {
      ...base,
      type: 'MATERIAL',
      materialId: item['materialId'] as string,
      materialType: item['materialType'] as string,
      sourceRef: item['sourceRef'] as string,
    };
  }

  return {
    ...base,
    type: item['type'] as 'CONCEPT' | 'MODULE',
    description: item['description'] as string,
  };
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

function toLearningState(item: Record<string, unknown>): LearningState {
  return {
    institutionId: item['institutionId'] as string,
    userId: item['userId'] as string,
    disciplineId: item['disciplineId'] as string,
    conceptId: item['conceptId'] as string,
    state: item['state'] as LearningState['state'],
    explanation: item['explanation'] as string,
    ruleVersion: item['ruleVersion'] as string,
    evidenceIds: item['evidenceIds'] as readonly string[],
    computedAt: item['computedAt'] as string,
  };
}

function toTranscriptLearningEvidence(
  item: Record<string, unknown>,
): LearningEvidence {
  return {
    id: item['id'] as string,
    institutionId: item['institutionId'] as string,
    userId: item['userId'] as string,
    disciplineId: item['disciplineId'] as string,
    conceptId: item['conceptId'] as string,
    occurredAt: item['occurredAt'] as string,
    sourceRef: item['sourceRef'] as string,
    origin: 'TRANSCRIPT',
    consentRef: item['consentRef'] as string,
  };
}

function toDetectedQuestion(item: Record<string, unknown>): DetectedQuestion {
  return {
    id: item['id'] as string,
    institutionId: item['institutionId'] as string,
    userId: item['userId'] as string,
    transcriptId: item['transcriptId'] as string,
    disciplineId: item['disciplineId'] as string,
    segmentIds: item['segmentIds'] as readonly string[],
    summary: item['summary'] as string,
    detectedAt: item['detectedAt'] as string,
    consentRef: item['consentRef'] as string,
  };
}
