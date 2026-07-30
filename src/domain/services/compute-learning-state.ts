import type { LearningEvidence } from '@/domain/entities/LearningEvidence';
import type { LearningStateValue } from '@/domain/entities/LearningState';
import type { StudySession } from '@/domain/entities/StudySession';

export const STATE_RULES_VERSION = 'state-rules/v1';

export type StateRuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7';

export interface ComputeLearningStateInput {
  readonly conceptId: string;
  readonly evidences: readonly LearningEvidence[];
  readonly studySessions: readonly StudySession[];
  readonly prerequisiteStates: readonly LearningStateValue[];
  readonly atInstant: string;
}

export interface ComputeLearningStateOutput {
  readonly state: LearningStateValue;
  readonly ruleId: StateRuleId;
  readonly ruleVersion: string;
  readonly explanation: string;
  readonly evidenceIds: readonly string[];
}

const BLOCKING_PREREQUISITE_STATES: ReadonlySet<LearningStateValue> =
  new Set(['POSSIBLE_DIFFICULTY', 'NEEDS_PRACTICE', 'NEEDS_REVIEW']);

function evidenceReference(evidence: LearningEvidence): string {
  return evidence.origin === 'TRANSCRIPT'
    ? `${evidence.id}, consentimento ${evidence.consentRef}`
    : evidence.id;
}

function output(
  state: LearningStateValue,
  ruleId: StateRuleId,
  explanation: string,
  evidences: readonly LearningEvidence[],
): ComputeLearningStateOutput {
  return {
    state,
    ruleId,
    ruleVersion: STATE_RULES_VERSION,
    explanation: `Calculado por ${STATE_RULES_VERSION} ${ruleId}: ${explanation}`,
    evidenceIds: evidences.map((evidence) => evidence.id),
  };
}

export function computeLearningState(
  input: ComputeLearningStateInput,
): ComputeLearningStateOutput {
  const overdueSession = input.studySessions.find(
    (session) =>
      session.status === 'PLANNED' &&
      session.scheduledFor < input.atInstant,
  );
  if (overdueSession) {
    return output(
      'NEEDS_REVIEW',
      'R1',
      `sessão de estudo planejada (${overdueSession.id}) com data vencida e ainda não concluída.`,
      [],
    );
  }

  const unresolvedTranscriptEvidences = input.evidences.filter(
    (evidence) =>
      evidence.origin === 'TRANSCRIPT' &&
      !input.studySessions.some(
        (session) =>
          session.status === 'DONE' &&
          session.scheduledFor > evidence.occurredAt,
      ),
  );
  if (unresolvedTranscriptEvidences.length > 0) {
    const references = unresolvedTranscriptEvidences
      .map(evidenceReference)
      .join('; ');
    return output(
      'POSSIBLE_DIFFICULTY',
      'R2',
      `${unresolvedTranscriptEvidences.length} dúvida(s) detectada(s) em aula (${references}), sem sessão de estudo concluída posteriormente.`,
      unresolvedTranscriptEvidences,
    );
  }

  const incorrectActivityEvidences = input.evidences.filter(
    (evidence) =>
      evidence.origin === 'ACTIVITY' && evidence.result === 'INCORRECT',
  );
  if (incorrectActivityEvidences.length > 0) {
    return output(
      'NEEDS_PRACTICE',
      'R3',
      `resposta(s) incorreta(s) registrada(s) em atividade (${incorrectActivityEvidences.map(evidenceReference).join('; ')}), indicando necessidade de nova prática sobre o conceito.`,
      incorrectActivityEvidences,
    );
  }

  if (
    input.evidences.length === 0 &&
    input.prerequisiteStates.some((state) =>
      BLOCKING_PREREQUISITE_STATES.has(state),
    )
  ) {
    return output(
      'BLOCKED',
      'R4',
      'conceito sem evidência própria e com pré-requisito direto que requer atenção.',
      [],
    );
  }

  const evidenceOrigins = new Set(
    input.evidences.map((evidence) => evidence.origin),
  );
  const correctActivityEvidence = input.evidences.find(
    (evidence) =>
      evidence.origin === 'ACTIVITY' && evidence.result === 'CORRECT',
  );
  const distinctOriginEvidence = input.evidences.find(
    (evidence) => evidence.origin !== 'ACTIVITY',
  );
  if (
    input.evidences.length >= 2 &&
    evidenceOrigins.size >= 2 &&
    correctActivityEvidence !== undefined &&
    distinctOriginEvidence !== undefined &&
    input.evidences.some((evidence) => evidence.origin !== 'ACCESS')
  ) {
    const supportingEvidences = [
      correctActivityEvidence,
      distinctOriginEvidence,
    ];
    return output(
      'LIKELY_UNDERSTOOD',
      'R5',
      `evidências de origens distintas (${supportingEvidences.map(evidenceReference).join('; ')}), incluindo atividade com resposta correta.`,
      supportingEvidences,
    );
  }

  if (input.evidences.length > 0) {
    return output(
      'IN_PROGRESS',
      'R6',
      `interação registrada com o conceito (${input.evidences.map(evidenceReference).join('; ')}).`,
      input.evidences,
    );
  }

  return output(
    'NOT_STARTED',
    'R7',
    'nenhuma evidência registrada para o conceito.',
    [],
  );
}
