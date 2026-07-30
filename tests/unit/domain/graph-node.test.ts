import { describe, expect, it } from 'vitest';
import type { GraphNode } from '@/domain/entities/GraphNode';

const baseNode = {
  institutionId: 'institution-fictional',
  disciplineId: 'discipline-statistics',
} as const;

describe('GraphNode', () => {
  it('represents a concept node', () => {
    const node: GraphNode = {
      ...baseNode,
      nodeId: 'concept-mediana',
      type: 'CONCEPT',
      title: 'Mediana',
      description: 'Medida de tendência central.',
    };

    expect(node.type).toBe('CONCEPT');
    expect(node.description).toBe('Medida de tendência central.');
  });

  it('represents a module node', () => {
    const node: GraphNode = {
      ...baseNode,
      nodeId: 'module-central-tendency',
      type: 'MODULE',
      title: 'Tendência central',
      description: 'Módulo fictício de Estatística I.',
    };

    expect(node.type).toBe('MODULE');
    expect(node.description).toBe('Módulo fictício de Estatística I.');
  });

  it('represents a material node', () => {
    const node: GraphNode = {
      ...baseNode,
      nodeId: 'material-central-tendency',
      type: 'MATERIAL',
      title: 'Apostila de tendência central',
      materialId: 'material-central-tendency',
      materialType: 'ARTICLE',
      sourceRef: 'materials/central-tendency.pdf',
    };

    expect(node.type).toBe('MATERIAL');
    expect(node.materialId).toBe('material-central-tendency');
  });
});
