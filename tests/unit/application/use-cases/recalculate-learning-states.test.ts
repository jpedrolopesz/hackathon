import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphRepository } from '@/application/ports/GraphRepository';
import type { LearningEvidenceRepository } from '@/application/ports/LearningEvidenceRepository';
import type { LearningStateRepository } from '@/application/ports/LearningStateRepository';
import type { StudySessionRepository } from '@/application/ports/StudySessionRepository';
import { RecalculateLearningStatesUseCase } from '@/application/use-cases/recalculate-learning-states';
import type { GraphEdge } from '@/domain/entities/GraphEdge';
import type {
  AccessLearningEvidence,
  ActivityLearningEvidence,
  LearningEvidence,
} from '@/domain/entities/LearningEvidence';
import type {
  LearningState,
  LearningStateValue,
} from '@/domain/entities/LearningState';
import type { StudySession } from '@/domain/entities/StudySession';

class FakeLearningStateRepository implements LearningStateRepository {
  states: LearningState[] = [];
  readonly savedBatches: LearningState[][] = [];
  reads = 0;

  async findByUserAndDiscipline(): Promise<readonly LearningState[]> {
    this.reads += 1;
    return this.states;
  }

  async saveMany(states: readonly LearningState[]): Promise<void> {
    this.savedBatches.push([...states]);
  }
}

class FakeLearningEvidenceRepository
  implements LearningEvidenceRepository
{
  evidences: LearningEvidence[] = [];
  readonly saved: LearningEvidence[] = [];
  reads = 0;

  async findByUserAndDiscipline(): Promise<
    readonly LearningEvidence[]
  > {
    this.reads += 1;
    return this.evidences;
  }

  async save(evidence: LearningEvidence): Promise<void> {
    this.saved.push(evidence);
  }
}

class FakeStudySessionRepository implements StudySessionRepository {
  sessions: StudySession[] = [];
  reads = 0;

  async findByUserAndDiscipline(): Promise<readonly StudySession[]> {
    this.reads += 1;
    return this.sessions;
  }
}

class FakeGraphRepository implements GraphRepository {
  edges: GraphEdge[] = [];
  reads = 0;

  async findPrerequisiteEdges(): Promise<readonly GraphEdge[]> {
    this.reads += 1;
    return this.edges;
  }
}

const input = {
  institutionId: 'institution-fictional',
  userId: 'user-fictional',
  disciplineId: 'discipline-statistics',
  changedConceptIds: ['concept-a'],
  atInstant: '2026-01-15T12:00:00.000Z',
} as const;

function state(
  conceptId: string,
  value: LearningStateValue,
): LearningState {
  return {
    institutionId: 'institution-fictional',
    userId: 'user-fictional',
    disciplineId: 'discipline-statistics',
    conceptId,
    state: value,
    explanation: 'Estado anterior calculado por regra fictícia.',
    ruleVersion: 'state-rules/v1',
    evidenceIds: [],
    computedAt: '2026-01-14T12:00:00.000Z',
  };
}

function accessEvidence(conceptId: string): AccessLearningEvidence {
  return {
    id: `evidence-${conceptId}`,
    institutionId: 'institution-fictional',
    userId: 'user-fictional',
    disciplineId: 'discipline-statistics',
    conceptId,
    occurredAt: '2026-01-15T10:00:00.000Z',
    sourceRef: 'material-statistics',
    origin: 'ACCESS',
  };
}

function incorrectEvidence(
  conceptId: string,
): ActivityLearningEvidence {
  return {
    id: `evidence-${conceptId}`,
    institutionId: 'institution-fictional',
    userId: 'user-fictional',
    disciplineId: 'discipline-statistics',
    conceptId,
    occurredAt: '2026-01-15T10:00:00.000Z',
    sourceRef: 'activity-statistics',
    origin: 'ACTIVITY',
    result: 'INCORRECT',
  };
}

function edge(fromNodeId: string, toNodeId: string): GraphEdge {
  return {
    id: `edge-${fromNodeId}-${toNodeId}`,
    institutionId: 'institution-fictional',
    disciplineId: 'discipline-statistics',
    type: 'PREREQUISITE_OF',
    fromNodeId,
    toNodeId,
    evidenceKind: 'OBSERVED',
  };
}

function setup() {
  const stateRepository = new FakeLearningStateRepository();
  const evidenceRepository = new FakeLearningEvidenceRepository();
  const sessionRepository = new FakeStudySessionRepository();
  const graphRepository = new FakeGraphRepository();
  const useCase = new RecalculateLearningStatesUseCase(
    stateRepository,
    evidenceRepository,
    sessionRepository,
    graphRepository,
  );
  return {
    stateRepository,
    evidenceRepository,
    sessionRepository,
    graphRepository,
    useCase,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecalculateLearningStatesUseCase', () => {
  it('persists an isolated concept whose state changes', async () => {
    const { stateRepository, evidenceRepository, useCase } = setup();
    stateRepository.states = [state('concept-a', 'NOT_STARTED')];
    evidenceRepository.evidences = [accessEvidence('concept-a')];

    const result = await useCase.execute(input);

    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({
      conceptId: 'concept-a',
      state: 'IN_PROGRESS',
      computedAt: input.atInstant,
      ruleVersion: 'state-rules/v1',
    });
    expect(stateRepository.savedBatches).toEqual([[result.updated[0]]]);
  });

  it('does not persist or propagate when the recalculated state is unchanged', async () => {
    const {
      stateRepository,
      evidenceRepository,
      graphRepository,
      useCase,
    } = setup();
    stateRepository.states = [
      state('concept-a', 'IN_PROGRESS'),
      state('concept-b', 'BLOCKED'),
    ];
    evidenceRepository.evidences = [accessEvidence('concept-a')];
    graphRepository.edges = [edge('concept-a', 'concept-b')];

    const result = await useCase.execute(input);

    expect(result.updated).toEqual([]);
    expect(stateRepository.savedBatches).toEqual([]);
  });

  it('propagates through a chain while each intermediate state changes', async () => {
    const {
      stateRepository,
      evidenceRepository,
      graphRepository,
      useCase,
    } = setup();
    stateRepository.states = [
      state('concept-a', 'NOT_STARTED'),
      state('concept-b', 'NOT_STARTED'),
      state('concept-c', 'BLOCKED'),
    ];
    evidenceRepository.evidences = [incorrectEvidence('concept-a')];
    graphRepository.edges = [
      edge('concept-a', 'concept-b'),
      edge('concept-b', 'concept-c'),
    ];

    const result = await useCase.execute(input);

    expect(result.updated.map((item) => item.conceptId)).toEqual([
      'concept-a',
      'concept-b',
      'concept-c',
    ]);
    expect(result.updated.map((item) => item.state)).toEqual([
      'NEEDS_PRACTICE',
      'BLOCKED',
      'NOT_STARTED',
    ]);
  });

  it('stops propagation when an intermediate state does not change', async () => {
    const {
      stateRepository,
      evidenceRepository,
      graphRepository,
      useCase,
    } = setup();
    stateRepository.states = [
      state('concept-a', 'NOT_STARTED'),
      state('concept-b', 'BLOCKED'),
      state('concept-c', 'BLOCKED'),
    ];
    evidenceRepository.evidences = [incorrectEvidence('concept-a')];
    graphRepository.edges = [
      edge('concept-a', 'concept-b'),
      edge('concept-b', 'concept-c'),
    ];

    const result = await useCase.execute(input);

    expect(result.updated.map((item) => item.conceptId)).toEqual([
      'concept-a',
    ]);
    expect(result.updated).not.toContainEqual(
      expect.objectContaining({ conceptId: 'concept-c' }),
    );
  });

  it('reads each collection exactly once during chain propagation', async () => {
    const {
      stateRepository,
      evidenceRepository,
      sessionRepository,
      graphRepository,
      useCase,
    } = setup();
    stateRepository.states = [
      state('concept-a', 'NOT_STARTED'),
      state('concept-b', 'NOT_STARTED'),
    ];
    evidenceRepository.evidences = [incorrectEvidence('concept-a')];
    graphRepository.edges = [edge('concept-a', 'concept-b')];

    await useCase.execute(input);

    expect(stateRepository.reads).toBe(1);
    expect(evidenceRepository.reads).toBe(1);
    expect(sessionRepository.reads).toBe(1);
    expect(graphRepository.reads).toBe(1);
  });

  it('starts a concept without persisted state as NOT_STARTED', async () => {
    const { stateRepository, useCase } = setup();

    await expect(useCase.execute(input)).resolves.toEqual({ updated: [] });
    expect(stateRepository.savedBatches).toEqual([]);
  });

  it('interrupts and logs when a cycle returns to an ancestor', async () => {
    const {
      stateRepository,
      evidenceRepository,
      graphRepository,
      useCase,
    } = setup();
    stateRepository.states = [
      state('concept-a', 'NOT_STARTED'),
      state('concept-b', 'NOT_STARTED'),
    ];
    evidenceRepository.evidences = [incorrectEvidence('concept-a')];
    graphRepository.edges = [
      edge('concept-a', 'concept-b'),
      edge('concept-b', 'concept-a'),
    ];
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await useCase.execute(input);

    expect(result.updated.map((item) => item.conceptId)).toEqual([
      'concept-a',
      'concept-b',
    ]);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain(
      '"event":"learning_state.recalculation_guard"',
    );
  });
});
