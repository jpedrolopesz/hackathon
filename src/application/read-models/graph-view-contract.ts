// Read-model devolvido pelo caso de uso: a aplicação define o contrato sem depender de src/web; nodeId vira id, e userId/consentRef são omitidos por minimização.
import type { LearningStateValue } from '@/domain/entities/LearningState';

export type GraphViewNodeType = 'CONCEPT' | 'MODULE' | 'MATERIAL' | 'DOUBT';

export type GraphViewEdgeType =
  | 'PREREQUISITE_OF'
  | 'BELONGS_TO_MODULE'
  | 'COVERS_CONCEPT'
  | 'DOUBT_ABOUT';

export type GraphViewEdgeStyle = 'SOLID' | 'DASHED';

export type GraphViewEvidenceKind = 'OBSERVED' | 'INFERRED';

export interface ConceptGraphViewNode {
  readonly id: string;
  readonly type: 'CONCEPT';
  readonly title: string;
  readonly description: string;
  readonly learningState: LearningStateValue;
  readonly explanation: string;
}

export interface ModuleGraphViewNode {
  readonly id: string;
  readonly type: 'MODULE';
  readonly title: string;
  readonly description: string;
}

export interface MaterialGraphViewNode {
  readonly id: string;
  readonly type: 'MATERIAL';
  readonly title: string;
  readonly materialType: string;
  readonly sourceRef: string;
}

export interface DoubtGraphViewNode {
  readonly id: string;
  readonly type: 'DOUBT';
  readonly summary: string;
  readonly createdAt: string;
}

export type GraphViewNode =
  | ConceptGraphViewNode
  | ModuleGraphViewNode
  | MaterialGraphViewNode
  | DoubtGraphViewNode;

export interface GraphViewEdge {
  readonly id: string;
  readonly type: GraphViewEdgeType;
  readonly source: string;
  readonly target: string;
  readonly evidenceKind: GraphViewEvidenceKind;
  readonly style: GraphViewEdgeStyle;
}

export interface GraphViewEnvelope {
  readonly data: {
    readonly discipline: {
      readonly id: string;
      readonly name: string;
      readonly semester: string;
    };
    readonly nodes: readonly GraphViewNode[];
    readonly edges: readonly GraphViewEdge[];
  };
  readonly meta: {
    readonly requestId: string;
  };
}
