import { describe, expect, it } from 'vitest';
import seedPayload from '../../../../seeds/estatistica-i.json';
import { graphViewMock } from '@/web/graph/graph-view-mock';
import {
  parseGraphSeed,
  type GraphSeed,
} from '@/infrastructure/seed/graph-seed-schema';

function cloneSeed(): GraphSeed {
  return structuredClone(parseGraphSeed(seedPayload));
}

describe('graphSeedSchema', () => {
  it('accepts the real Estatística I seed', () => {
    expect(() => parseGraphSeed(seedPayload)).not.toThrow();
  });

  it('contains the validated quantities of concepts, modules and materials', () => {
    const seed = parseGraphSeed(seedPayload);

    expect(seed.concepts).toHaveLength(15);
    expect(seed.modules).toHaveLength(4);
    expect(seed.materials).toHaveLength(4);
  });

  it('rejects a concept that references a missing module', () => {
    const seed = cloneSeed();
    const firstConcept = seed.concepts[0];
    if (!firstConcept) {
      throw new Error('O seed de teste precisa conter ao menos um conceito.');
    }

    expect(() =>
      parseGraphSeed({
        ...seed,
        concepts: [
          { ...firstConcept, moduleId: 'module-missing' },
          ...seed.concepts.slice(1),
        ],
      }),
    ).toThrow(/módulo inexistente/);
  });

  it('rejects a prerequisite that references a missing concept', () => {
    const seed = cloneSeed();

    expect(() =>
      parseGraphSeed({
        ...seed,
        edges: {
          ...seed.edges,
          prerequisites: [
            ...seed.edges.prerequisites,
            {
              fromConceptId: 'concept-arithmetic-mean',
              toConceptId: 'concept-missing',
            },
          ],
        },
      }),
    ).toThrow(/conceito inexistente/);
  });

  it('rejects a duplicated id across graph entities', () => {
    const seed = cloneSeed();
    const firstConcept = seed.concepts[0];
    const firstMaterial = seed.materials[0];
    if (!firstConcept || !firstMaterial) {
      throw new Error('O seed de teste precisa conter conceito e material.');
    }

    expect(() =>
      parseGraphSeed({
        ...seed,
        materials: [
          { ...firstMaterial, id: firstConcept.id },
          ...seed.materials.slice(1),
        ],
      }),
    ).toThrow(/ID duplicado/);
  });

  it('uses exactly the same concept ids as the Graph View mock', () => {
    const seedConceptIds = new Set(
      parseGraphSeed(seedPayload).concepts.map((concept) => concept.id),
    );
    const mockConceptIds = new Set(
      graphViewMock.data.nodes
        .filter((node) => node.type === 'CONCEPT')
        .map((node) => node.id),
    );

    expect(seedConceptIds).toEqual(mockConceptIds);
  });
});
