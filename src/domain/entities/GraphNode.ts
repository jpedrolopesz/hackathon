interface GraphNodeBase {
  readonly nodeId: string;
  readonly institutionId: string;
  readonly disciplineId: string;
  readonly title: string;
}

export type GraphNodeType = 'CONCEPT' | 'MODULE' | 'MATERIAL';

export interface ConceptGraphNode extends GraphNodeBase {
  readonly type: 'CONCEPT';
  readonly description: string;
}

export interface ModuleGraphNode extends GraphNodeBase {
  readonly type: 'MODULE';
  readonly description: string;
}

export interface MaterialGraphNode extends GraphNodeBase {
  readonly type: 'MATERIAL';
  readonly materialId: string;
  readonly materialType: string;
  readonly sourceRef: string;
}

export type GraphNode = ConceptGraphNode | ModuleGraphNode | MaterialGraphNode;
