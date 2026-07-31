import { z } from 'zod';

const disciplineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  semester: z.string().min(1),
  courseId: z.string().min(1),
});

const moduleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

const conceptSchema = z.object({
  id: z.string().min(1),
  moduleId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

const materialSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  materialType: z.enum([
    'HANDOUT',
    'VIDEO',
    'EXERCISE_LIST',
    'SIMULATED_EXAM',
  ]),
  sourceRef: z.string().min(1),
});

const graphSeedShapeSchema = z.object({
  discipline: disciplineSchema,
  modules: z.array(moduleSchema),
  concepts: z.array(conceptSchema),
  materials: z.array(materialSchema),
  edges: z.object({
    belongsToModule: z.array(
      z.object({
        conceptId: z.string().min(1),
        moduleId: z.string().min(1),
      }),
    ),
    prerequisites: z.array(
      z.object({
        fromConceptId: z.string().min(1),
        toConceptId: z.string().min(1),
      }),
    ),
    coversConcept: z.array(
      z.object({
        materialId: z.string().min(1),
        conceptId: z.string().min(1),
      }),
    ),
  }),
});

export const graphSeedSchema = graphSeedShapeSchema.superRefine(
  (seed, context) => {
    const moduleIds = new Set(seed.modules.map((module) => module.id));
    const conceptIds = new Set(seed.concepts.map((concept) => concept.id));
    const materialIds = new Set(seed.materials.map((material) => material.id));

    for (const concept of seed.concepts) {
      if (!moduleIds.has(concept.moduleId)) {
        context.addIssue({
          code: 'custom',
          message: `O conceito ${concept.id} referencia o módulo inexistente ${concept.moduleId}.`,
          path: ['concepts'],
        });
      }
    }

    for (const edge of seed.edges.belongsToModule) {
      if (!conceptIds.has(edge.conceptId) || !moduleIds.has(edge.moduleId)) {
        context.addIssue({
          code: 'custom',
          message: `A aresta BELONGS_TO_MODULE referencia conceito ou módulo inexistente: ${edge.conceptId} -> ${edge.moduleId}.`,
          path: ['edges', 'belongsToModule'],
        });
      }
    }

    for (const edge of seed.edges.prerequisites) {
      if (
        !conceptIds.has(edge.fromConceptId) ||
        !conceptIds.has(edge.toConceptId)
      ) {
        context.addIssue({
          code: 'custom',
          message: `A aresta PREREQUISITE_OF referencia conceito inexistente: ${edge.fromConceptId} -> ${edge.toConceptId}.`,
          path: ['edges', 'prerequisites'],
        });
      }
    }

    for (const edge of seed.edges.coversConcept) {
      if (
        !materialIds.has(edge.materialId) ||
        !conceptIds.has(edge.conceptId)
      ) {
        context.addIssue({
          code: 'custom',
          message: `A aresta COVERS_CONCEPT referencia material ou conceito inexistente: ${edge.materialId} -> ${edge.conceptId}.`,
          path: ['edges', 'coversConcept'],
        });
      }
    }

    const allIds = [
      ...seed.modules.map((module) => module.id),
      ...seed.concepts.map((concept) => concept.id),
      ...seed.materials.map((material) => material.id),
    ];
    const seenIds = new Set<string>();
    for (const id of allIds) {
      if (seenIds.has(id)) {
        context.addIssue({
          code: 'custom',
          message: `ID duplicado entre módulos, conceitos e materiais: ${id}.`,
          path: [],
        });
      }
      seenIds.add(id);
    }
  },
);

export type GraphSeed = z.infer<typeof graphSeedSchema>;

export function parseGraphSeed(payload: unknown): GraphSeed {
  return graphSeedSchema.parse(payload);
}
