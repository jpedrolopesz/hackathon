export type GraphEdgeType =
  | 'PREREQUISITE_OF'
  | 'BELONGS_TO_MODULE'
  | 'COVERS_CONCEPT'
  | 'DOUBT_ABOUT';

export type GraphEdgeEvidenceKind = 'OBSERVED' | 'INFERRED';

export interface GraphEdge {
  readonly id: string;
  readonly institutionId: string;
  readonly disciplineId: string;
  readonly type: GraphEdgeType;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly evidenceKind: GraphEdgeEvidenceKind;
}
