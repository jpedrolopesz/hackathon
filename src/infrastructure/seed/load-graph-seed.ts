import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { GraphSeed } from '@/infrastructure/seed/graph-seed-schema';

type PutWriteRequest = {
  PutRequest: { Item: Record<string, unknown> };
};

const BATCH_WRITE_LIMIT = 25;

export interface LoadGraphSeedInput {
  readonly institutionId: string;
  readonly seed: GraphSeed;
}

export interface LoadGraphSeedResult {
  readonly itemsWritten: number;
}

/**
 * Todas as chaves são derivadas dos ids estáveis do seed. Reexecutar a carga
 * sobrescreve os mesmos itens, sem duplicar ou apagar dados preexistentes.
 * BatchWriteItem limita cada lote a 25 e apenas UnprocessedItems são reenviados.
 */
export async function loadGraphSeed(
  client: DynamoDBDocumentClient,
  tableName: string,
  input: LoadGraphSeedInput,
): Promise<LoadGraphSeedResult> {
  const { institutionId, seed } = input;
  const partitionKey = `DISC#${seed.discipline.id}`;
  const items: Record<string, unknown>[] = [
    {
      PK: partitionKey,
      SK: 'METADATA',
      institutionId,
      disciplineId: seed.discipline.id,
      id: seed.discipline.id,
      name: seed.discipline.name,
      semester: seed.discipline.semester,
      courseId: seed.discipline.courseId,
    },
    ...seed.modules.map((module) => ({
      PK: partitionKey,
      SK: `NODE#MODULE#${module.id}`,
      institutionId,
      disciplineId: seed.discipline.id,
      nodeId: module.id,
      type: 'MODULE',
      title: module.title,
      description: module.description,
    })),
    ...seed.concepts.map((concept) => ({
      PK: partitionKey,
      SK: `NODE#CONCEPT#${concept.id}`,
      institutionId,
      disciplineId: seed.discipline.id,
      nodeId: concept.id,
      type: 'CONCEPT',
      title: concept.title,
      description: concept.description,
    })),
    ...seed.materials.flatMap((material) => [
      {
        PK: partitionKey,
        SK: `MATERIAL#${material.id}`,
        institutionId,
        disciplineId: seed.discipline.id,
        id: material.id,
        title: material.title,
        materialType: material.materialType,
        sourceRef: material.sourceRef,
      },
      {
        PK: partitionKey,
        SK: `NODE#MATERIAL#${material.id}`,
        institutionId,
        disciplineId: seed.discipline.id,
        nodeId: material.id,
        type: 'MATERIAL',
        materialId: material.id,
        title: material.title,
        materialType: material.materialType,
        sourceRef: material.sourceRef,
      },
    ]),
    ...seed.edges.belongsToModule.map((edge) =>
      graphEdgeItem(
        partitionKey,
        institutionId,
        seed.discipline.id,
        'BELONGS_TO_MODULE',
        edge.conceptId,
        edge.moduleId,
      ),
    ),
    ...seed.edges.prerequisites.map((edge) =>
      graphEdgeItem(
        partitionKey,
        institutionId,
        seed.discipline.id,
        'PREREQUISITE_OF',
        edge.fromConceptId,
        edge.toConceptId,
      ),
    ),
    ...seed.edges.coversConcept.map((edge) =>
      graphEdgeItem(
        partitionKey,
        institutionId,
        seed.discipline.id,
        'COVERS_CONCEPT',
        edge.materialId,
        edge.conceptId,
      ),
    ),
  ];

  const requests: PutWriteRequest[] = items.map((item) => ({
    PutRequest: { Item: item },
  }));
  for (
    let offset = 0;
    offset < requests.length;
    offset += BATCH_WRITE_LIMIT
  ) {
    await writeBatchWithRetry(
      client,
      tableName,
      requests.slice(offset, offset + BATCH_WRITE_LIMIT),
    );
  }

  return { itemsWritten: items.length };
}

function graphEdgeItem(
  partitionKey: string,
  institutionId: string,
  disciplineId: string,
  type: 'BELONGS_TO_MODULE' | 'PREREQUISITE_OF' | 'COVERS_CONCEPT',
  fromNodeId: string,
  toNodeId: string,
): Record<string, unknown> {
  return {
    PK: partitionKey,
    SK: `EDGE#${type}#${fromNodeId}#${toNodeId}`,
    institutionId,
    disciplineId,
    id: `edge-${type.toLowerCase()}-${fromNodeId}-${toNodeId}`,
    type,
    fromNodeId,
    toNodeId,
    evidenceKind: 'OBSERVED',
  };
}

async function writeBatchWithRetry(
  client: DynamoDBDocumentClient,
  tableName: string,
  batch: readonly PutWriteRequest[],
): Promise<void> {
  let pending = batch;

  while (pending.length > 0) {
    const result = await client.send(
      new BatchWriteCommand({
        RequestItems: { [tableName]: [...pending] },
      }),
    );
    pending =
      (result.UnprocessedItems?.[
        tableName
      ] as PutWriteRequest[] | undefined) ?? [];
  }
}
