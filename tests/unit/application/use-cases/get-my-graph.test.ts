import { describe, expect, it } from 'vitest';
import type {
  GraphViewRepository,
  InstitutionalGraph,
  UserGraphOverlay,
} from '@/application/ports/GraphViewRepository';
import { GetMyGraphUseCase } from '@/application/use-cases/get-my-graph';
import type { DetectedQuestion } from '@/domain/entities/DetectedQuestion';
import type { Discipline } from '@/domain/entities/Discipline';
import type { GraphEdge } from '@/domain/entities/GraphEdge';
import type { GraphNode } from '@/domain/entities/GraphNode';
import type { TranscriptLearningEvidence } from '@/domain/entities/LearningEvidence';
import type { LearningState } from '@/domain/entities/LearningState';

class FakeGraphViewRepository implements GraphViewRepository {
  institutional: InstitutionalGraph = {
    discipline: null,
    nodes: [],
    edges: [],
  };
  overlay: UserGraphOverlay = {
    states: [],
    transcriptEvidences: [],
    detectedQuestions: [],
  };
  institutionalCalls = 0;
  overlayCalls = 0;

  async findInstitutionalGraph(): Promise<InstitutionalGraph> {
    this.institutionalCalls += 1;
    return this.institutional;
  }

  async findUserOverlay(): Promise<UserGraphOverlay> {
    this.overlayCalls += 1;
    return this.overlay;
  }
}

const context = {
  institutionId: 'institution-fictional',
  userId: 'user-fictional',
  role: 'ALUNO',
} as const;

const discipline: Discipline = {
  id: 'discipline-statistics',
  institutionId: 'institution-fictional',
  courseId: 'course-statistics-fictional',
  name: 'Estatística I',
  semester: 'semestre-ficticio',
  createdAt: '2026-01-01T09:00:00.000Z',
};

const conceptNode: GraphNode = {
  nodeId: 'concept-median',
  institutionId: 'institution-fictional',
  disciplineId: 'discipline-statistics',
  type: 'CONCEPT',
  title: 'Mediana',
  description: 'Valor central dos dados após sua ordenação.',
};

const moduleNode: GraphNode = {
  nodeId: 'module-central-tendency',
  institutionId: 'institution-fictional',
  disciplineId: 'discipline-statistics',
  type: 'MODULE',
  title: 'Tendência central',
  description: 'Medidas que representam valores centrais.',
};

const institutionalEdge: GraphEdge = {
  id: 'edge-median-module',
  institutionId: 'institution-fictional',
  disciplineId: 'discipline-statistics',
  type: 'BELONGS_TO_MODULE',
  fromNodeId: 'concept-median',
  toNodeId: 'module-central-tendency',
  evidenceKind: 'OBSERVED',
};

const learningState: LearningState = {
  institutionId: 'institution-fictional',
  userId: 'user-fictional',
  disciplineId: 'discipline-statistics',
  conceptId: 'concept-median',
  state: 'IN_PROGRESS',
  explanation:
    'Calculado por state-rules/v1 R6: interação registrada com o conceito.',
  ruleVersion: 'state-rules/v1',
  evidenceIds: ['evidence-access'],
  computedAt: '2026-01-12T10:00:00.000Z',
};

const question: DetectedQuestion = {
  id: 'question-mean-median',
  institutionId: 'institution-fictional',
  userId: 'user-fictional',
  transcriptId: 'transcript-statistics',
  disciplineId: 'discipline-statistics',
  segmentIds: ['segment-fictional'],
  summary: 'Diferença entre média e mediana',
  detectedAt: '2026-01-12T10:05:00.000Z',
  consentRef: 'consent-fictional',
};

function transcriptEvidence(
  sourceRef = 'question-mean-median',
): TranscriptLearningEvidence {
  return {
    id: 'evidence-transcript',
    institutionId: 'institution-fictional',
    userId: 'user-fictional',
    disciplineId: 'discipline-statistics',
    conceptId: 'concept-median',
    occurredAt: '2026-01-12T10:05:00.000Z',
    sourceRef,
    origin: 'TRANSCRIPT',
    consentRef: 'consent-fictional',
  };
}

function setup() {
  const repository = new FakeGraphViewRepository();
  repository.institutional = {
    discipline,
    nodes: [conceptNode, moduleNode],
    edges: [institutionalEdge],
  };
  const useCase = new GetMyGraphUseCase(repository);
  return { repository, useCase };
}

describe('GetMyGraphUseCase', () => {
  it('maps discipline, institutional nodes and observed solid edges', async () => {
    const { useCase } = setup();

    const result = await useCase.execute(context, {
      disciplineId: 'discipline-statistics',
    });

    expect(result.discipline).toEqual({
      id: 'discipline-statistics',
      name: 'Estatística I',
      semester: 'semestre-ficticio',
    });
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'concept-median',
          type: 'CONCEPT',
        }),
        expect.objectContaining({
          id: 'module-central-tendency',
          type: 'MODULE',
        }),
      ]),
    );
    expect(result.edges).toContainEqual({
      id: 'edge-median-module',
      type: 'BELONGS_TO_MODULE',
      source: 'concept-median',
      target: 'module-central-tendency',
      evidenceKind: 'OBSERVED',
      style: 'SOLID',
    });
  });

  it('adds the corresponding state and explanation to a concept', async () => {
    const { repository, useCase } = setup();
    repository.overlay = {
      ...repository.overlay,
      states: [learningState],
    };

    const result = await useCase.execute(context, {
      disciplineId: 'discipline-statistics',
    });

    expect(result.nodes).toContainEqual(
      expect.objectContaining({
        id: 'concept-median',
        learningState: 'IN_PROGRESS',
        explanation: learningState.explanation,
      }),
    );
  });

  it('uses NOT_STARTED and a neutral explanation without a state', async () => {
    const { useCase } = setup();

    const result = await useCase.execute(context, {
      disciplineId: 'discipline-statistics',
    });

    expect(result.nodes).toContainEqual(
      expect.objectContaining({
        id: 'concept-median',
        learningState: 'NOT_STARTED',
        explanation: 'Ainda não há evidência registrada para este conceito.',
      }),
    );
  });

  it('projects a detected question as a DOUBT node', async () => {
    const { repository, useCase } = setup();
    repository.overlay = {
      ...repository.overlay,
      detectedQuestions: [question],
    };

    const result = await useCase.execute(context, {
      disciplineId: 'discipline-statistics',
    });

    expect(result.nodes).toContainEqual({
      id: 'question-mean-median',
      type: 'DOUBT',
      summary: 'Diferença entre média e mediana',
      createdAt: '2026-01-12T10:05:00.000Z',
    });
  });

  it('projects transcript evidence as an inferred dashed DOUBT_ABOUT edge', async () => {
    const { repository, useCase } = setup();
    repository.overlay = {
      states: [],
      detectedQuestions: [question],
      transcriptEvidences: [transcriptEvidence()],
    };

    const result = await useCase.execute(context, {
      disciplineId: 'discipline-statistics',
    });

    expect(result.edges).toContainEqual({
      id: 'edge-doubt-about-question-mean-median-concept-median',
      type: 'DOUBT_ABOUT',
      source: 'question-mean-median',
      target: 'concept-median',
      evidenceKind: 'INFERRED',
      style: 'DASHED',
    });
  });

  it('ignores transcript evidence whose question is absent', async () => {
    const { repository, useCase } = setup();
    repository.overlay = {
      states: [],
      detectedQuestions: [question],
      transcriptEvidences: [transcriptEvidence('question-orphan')],
    };

    const result = await useCase.execute(context, {
      disciplineId: 'discipline-statistics',
    });

    expect(
      result.edges.some((edge) => edge.type === 'DOUBT_ABOUT'),
    ).toBe(false);
  });

  it('does not expose userId or consentRef anywhere in the payload', async () => {
    const { repository, useCase } = setup();
    repository.overlay = {
      states: [learningState],
      detectedQuestions: [question],
      transcriptEvidences: [transcriptEvidence()],
    };

    const serialized = JSON.stringify(
      await useCase.execute(context, {
        disciplineId: 'discipline-statistics',
      }),
    );

    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('consentRef');
    expect(serialized).not.toContain('consent-fictional');
  });

  it('rejects a discipline returned from another institution', async () => {
    const { repository, useCase } = setup();
    repository.institutional = {
      ...repository.institutional,
      discipline: {
        ...discipline,
        institutionId: 'institution-foreign-fictional',
      },
    };

    await expect(
      useCase.execute(context, {
        disciplineId: 'discipline-statistics',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(repository.overlayCalls).toBe(0);
  });

  it('throws NotFoundError when the discipline does not exist', async () => {
    const { repository, useCase } = setup();
    repository.institutional = {
      discipline: null,
      nodes: [],
      edges: [],
    };

    await expect(
      useCase.execute(context, {
        disciplineId: 'discipline-missing',
      }),
    ).rejects.toMatchObject({ code: 'GRAPH_DISCIPLINE_NOT_FOUND' });
    expect(repository.overlayCalls).toBe(0);
  });

  it('calls each read-model method exactly once', async () => {
    const { repository, useCase } = setup();

    await useCase.execute(context, {
      disciplineId: 'discipline-statistics',
    });

    expect(repository.institutionalCalls).toBe(1);
    expect(repository.overlayCalls).toBe(1);
  });
});
