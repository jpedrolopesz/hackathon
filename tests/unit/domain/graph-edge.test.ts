import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '@/domain/entities/GraphEdge';

describe('GraphEdge', () => {
  it('represents an inferred relationship between a doubt and a concept', () => {
    const edge: GraphEdge = {
      id: 'edge-doubt-mediana',
      institutionId: 'institution-fictional',
      disciplineId: 'discipline-statistics',
      type: 'DOUBT_ABOUT',
      fromNodeId: 'doubt-media-mediana',
      toNodeId: 'concept-mediana',
      evidenceKind: 'INFERRED',
    };

    expect(edge.type).toBe('DOUBT_ABOUT');
    expect(edge.evidenceKind).toBe('INFERRED');
  });
});
