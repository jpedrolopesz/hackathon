import type { GraphRepository } from '@/application/ports/GraphRepository';
import type { LearningEvidenceRepository } from '@/application/ports/LearningEvidenceRepository';
import type { LearningStateRepository } from '@/application/ports/LearningStateRepository';
import type { StudySessionRepository } from '@/application/ports/StudySessionRepository';
import type { LearningEvidence } from '@/domain/entities/LearningEvidence';
import type {
  LearningState,
  LearningStateValue,
} from '@/domain/entities/LearningState';
import type { StudySession } from '@/domain/entities/StudySession';
import { computeLearningState } from '@/domain/services/compute-learning-state';
import { structuredLog } from '@/shared/observability/structured-log';

export interface RecalculateLearningStatesInput {
  readonly institutionId: string;
  readonly userId: string;
  readonly disciplineId: string;
  readonly changedConceptIds: readonly string[];
  readonly atInstant: string;
}

export interface RecalculateLearningStatesResult {
  readonly updated: readonly LearningState[];
}

interface QueueItem {
  readonly conceptId: string;
  readonly ancestors: ReadonlySet<string>;
}

export class RecalculateLearningStatesUseCase {
  constructor(
    private readonly learningStateRepository: LearningStateRepository,
    private readonly learningEvidenceRepository: LearningEvidenceRepository,
    private readonly studySessionRepository: StudySessionRepository,
    private readonly graphRepository: GraphRepository,
  ) {}

  async execute(
    input: RecalculateLearningStatesInput,
  ): Promise<RecalculateLearningStatesResult> {
    const [evidences, studySessions, currentStates, prerequisiteEdges] =
      await Promise.all([
        this.learningEvidenceRepository.findByUserAndDiscipline(
          input.institutionId,
          input.userId,
          input.disciplineId,
        ),
        this.studySessionRepository.findByUserAndDiscipline(
          input.institutionId,
          input.userId,
          input.disciplineId,
        ),
        this.learningStateRepository.findByUserAndDiscipline(
          input.institutionId,
          input.userId,
          input.disciplineId,
        ),
        this.graphRepository.findPrerequisiteEdges(
          input.institutionId,
          input.disciplineId,
        ),
      ]);

    const evidencesByConcept = groupEvidencesByConcept(evidences);
    const sessionsByConcept = groupSessionsByConcept(studySessions);
    const prerequisitesByConcept = new Map<string, string[]>();
    const dependentsByConcept = new Map<string, string[]>();
    const knownConceptIds = new Set(input.changedConceptIds);

    for (const state of currentStates) {
      knownConceptIds.add(state.conceptId);
    }
    for (const evidence of evidences) {
      knownConceptIds.add(evidence.conceptId);
    }
    for (const session of studySessions) {
      knownConceptIds.add(session.conceptId);
    }
    for (const edge of prerequisiteEdges) {
      if (edge.type !== 'PREREQUISITE_OF') {
        continue;
      }
      appendToIndex(prerequisitesByConcept, edge.toNodeId, edge.fromNodeId);
      appendToIndex(dependentsByConcept, edge.fromNodeId, edge.toNodeId);
      knownConceptIds.add(edge.fromNodeId);
      knownConceptIds.add(edge.toNodeId);
    }

    const persistedStateByConcept = new Map(
      currentStates.map((state) => [state.conceptId, state]),
    );
    const workingStateByConcept = new Map<string, LearningStateValue>(
      currentStates.map((state) => [state.conceptId, state.state]),
    );
    const updatedByConcept = new Map<string, LearningState>();
    const queue: QueueItem[] = input.changedConceptIds.map((conceptId) => ({
      conceptId,
      ancestors: new Set([conceptId]),
    }));
    const maxRecalculations = 4 * Math.max(knownConceptIds.size, 1);
    let recalculationCount = 0;
    let guardTriggered = false;

    while (queue.length > 0 && !guardTriggered) {
      if (recalculationCount >= maxRecalculations) {
        logCycleGuard(input, recalculationCount, maxRecalculations);
        break;
      }

      const item = queue.shift();
      if (!item) {
        break;
      }
      recalculationCount += 1;

      const currentState =
        workingStateByConcept.get(item.conceptId) ?? 'NOT_STARTED';
      const prerequisiteStates = (
        prerequisitesByConcept.get(item.conceptId) ?? []
      ).map(
        (conceptId) =>
          workingStateByConcept.get(conceptId) ?? 'NOT_STARTED',
      );
      const computed = computeLearningState({
        conceptId: item.conceptId,
        evidences: evidencesByConcept.get(item.conceptId) ?? [],
        studySessions: sessionsByConcept.get(item.conceptId) ?? [],
        prerequisiteStates,
        atInstant: input.atInstant,
      });

      if (computed.state === currentState) {
        continue;
      }

      workingStateByConcept.set(item.conceptId, computed.state);
      const updatedState: LearningState = {
        institutionId: input.institutionId,
        userId: input.userId,
        disciplineId: input.disciplineId,
        conceptId: item.conceptId,
        state: computed.state,
        explanation: computed.explanation,
        ruleVersion: computed.ruleVersion,
        evidenceIds: computed.evidenceIds,
        computedAt: input.atInstant,
      };

      if (
        persistedStateByConcept.get(item.conceptId)?.state === computed.state
      ) {
        updatedByConcept.delete(item.conceptId);
      } else {
        updatedByConcept.set(item.conceptId, updatedState);
      }

      for (const dependentId of dependentsByConcept.get(item.conceptId) ?? []) {
        if (item.ancestors.has(dependentId)) {
          logCycleGuard(input, recalculationCount, maxRecalculations);
          guardTriggered = true;
          break;
        }
        queue.push({
          conceptId: dependentId,
          ancestors: new Set([...item.ancestors, dependentId]),
        });
      }
    }

    const updated = [...updatedByConcept.values()];
    if (updated.length > 0) {
      await this.learningStateRepository.saveMany(updated);
    }

    return { updated };
  }
}

function groupEvidencesByConcept(
  evidences: readonly LearningEvidence[],
): Map<string, LearningEvidence[]> {
  const index = new Map<string, LearningEvidence[]>();
  for (const evidence of evidences) {
    appendToIndex(index, evidence.conceptId, evidence);
  }
  return index;
}

function groupSessionsByConcept(
  sessions: readonly StudySession[],
): Map<string, StudySession[]> {
  const index = new Map<string, StudySession[]>();
  for (const session of sessions) {
    appendToIndex(index, session.conceptId, session);
  }
  return index;
}

function appendToIndex<T>(index: Map<string, T[]>, key: string, value: T) {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}

function logCycleGuard(
  input: RecalculateLearningStatesInput,
  recalculationCount: number,
  maxRecalculations: number,
) {
  structuredLog('warn', {
    event: 'learning_state.recalculation_guard',
    institutionId: input.institutionId,
    userId: input.userId,
    disciplineId: input.disciplineId,
    recalculationCount,
    maxRecalculations,
    decision: 'INTERRUPTED',
  });
}
