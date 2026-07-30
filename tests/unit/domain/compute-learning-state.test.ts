import { describe, expect, it } from 'vitest';
import { computeLearningState } from '@/domain/services/compute-learning-state';
import type {
  AccessLearningEvidence,
  ActivityLearningEvidence,
  TranscriptLearningEvidence,
} from '@/domain/entities/LearningEvidence';
import type { LearningStateValue } from '@/domain/entities/LearningState';
import type { StudySession } from '@/domain/entities/StudySession';

const atInstant = '2026-01-15T12:00:00.000Z';

function accessEvidence(
  id: string,
  overrides: Partial<AccessLearningEvidence> = {},
): AccessLearningEvidence {
  return {
    id,
    institutionId: 'institution-fictional',
    userId: 'user-fictional',
    disciplineId: 'discipline-statistics',
    conceptId: 'concept-mediana',
    occurredAt: '2026-01-14T10:00:00.000Z',
    sourceRef: 'material-statistics',
    origin: 'ACCESS',
    ...overrides,
  };
}

function activityEvidence(
  id: string,
  result: 'CORRECT' | 'INCORRECT',
  overrides: Partial<ActivityLearningEvidence> = {},
): ActivityLearningEvidence {
  return {
    id,
    institutionId: 'institution-fictional',
    userId: 'user-fictional',
    disciplineId: 'discipline-statistics',
    conceptId: 'concept-mediana',
    occurredAt: '2026-01-14T10:30:00.000Z',
    sourceRef: 'activity-statistics',
    origin: 'ACTIVITY',
    result,
    ...overrides,
  };
}

function transcriptEvidence(
  id: string,
  overrides: Partial<TranscriptLearningEvidence> = {},
): TranscriptLearningEvidence {
  return {
    id,
    institutionId: 'institution-fictional',
    userId: 'user-fictional',
    disciplineId: 'discipline-statistics',
    conceptId: 'concept-mediana',
    occurredAt: '2026-01-14T09:00:00.000Z',
    sourceRef: 'question-statistics',
    origin: 'TRANSCRIPT',
    consentRef: 'consent-fictional',
    ...overrides,
  };
}

function studySession(
  overrides: Partial<StudySession> = {},
): StudySession {
  return {
    id: 'session-fictional',
    institutionId: 'institution-fictional',
    userId: 'user-fictional',
    disciplineId: 'discipline-statistics',
    conceptId: 'concept-mediana',
    recommendationId: 'recommendation-fictional',
    scheduledFor: '2026-01-14T12:00:00.000Z',
    durationMinutes: 30,
    status: 'PLANNED',
    createdAt: '2026-01-13T12:00:00.000Z',
    ...overrides,
  };
}

function compute(
  overrides: {
    evidences?: ComputeParameters['evidences'];
    studySessions?: ComputeParameters['studySessions'];
    prerequisiteStates?: readonly LearningStateValue[];
  } = {},
) {
  return computeLearningState({
    conceptId: 'concept-mediana',
    evidences: overrides.evidences ?? [],
    studySessions: overrides.studySessions ?? [],
    prerequisiteStates: overrides.prerequisiteStates ?? [],
    atInstant,
  });
}

interface ComputeParameters {
  readonly evidences: Parameters<typeof computeLearningState>[0]['evidences'];
  readonly studySessions: Parameters<
    typeof computeLearningState
  >[0]['studySessions'];
}

describe('computeLearningState state-rules/v1', () => {
  it('applies R1 NEEDS_REVIEW to an overdue planned session', () => {
    expect(compute({ studySessions: [studySession()] })).toMatchObject({
      state: 'NEEDS_REVIEW',
      ruleId: 'R1',
      evidenceIds: [],
    });
  });

  it('applies R2 POSSIBLE_DIFFICULTY to an unresolved transcript evidence', () => {
    expect(
      compute({ evidences: [transcriptEvidence('evidence-transcript')] }),
    ).toMatchObject({
      state: 'POSSIBLE_DIFFICULTY',
      ruleId: 'R2',
      evidenceIds: ['evidence-transcript'],
    });
  });

  it('applies R3 NEEDS_PRACTICE to an incorrect activity', () => {
    expect(
      compute({
        evidences: [activityEvidence('evidence-incorrect', 'INCORRECT')],
      }),
    ).toMatchObject({
      state: 'NEEDS_PRACTICE',
      ruleId: 'R3',
      evidenceIds: ['evidence-incorrect'],
    });
  });

  it('applies R4 BLOCKED when evidence is absent and a prerequisite requires attention', () => {
    expect(
      compute({ prerequisiteStates: ['POSSIBLE_DIFFICULTY'] }),
    ).toMatchObject({
      state: 'BLOCKED',
      ruleId: 'R4',
      evidenceIds: [],
    });
  });

  it('applies R5 LIKELY_UNDERSTOOD with distinct origins and a correct activity', () => {
    expect(
      compute({
        evidences: [
          activityEvidence('evidence-correct', 'CORRECT'),
          accessEvidence('evidence-access'),
        ],
      }),
    ).toMatchObject({
      state: 'LIKELY_UNDERSTOOD',
      ruleId: 'R5',
      evidenceIds: ['evidence-correct', 'evidence-access'],
    });
  });

  it('applies R6 IN_PROGRESS when any evidence exists', () => {
    expect(
      compute({ evidences: [accessEvidence('evidence-access')] }),
    ).toMatchObject({
      state: 'IN_PROGRESS',
      ruleId: 'R6',
      evidenceIds: ['evidence-access'],
    });
  });

  it('applies R7 NOT_STARTED when evidence is absent', () => {
    expect(compute()).toMatchObject({
      state: 'NOT_STARTED',
      ruleId: 'R7',
      evidenceIds: [],
    });
  });

  it('gives R2 precedence over R3', () => {
    expect(
      compute({
        evidences: [
          transcriptEvidence('evidence-transcript'),
          activityEvidence('evidence-incorrect', 'INCORRECT'),
        ],
      }),
    ).toMatchObject({
      state: 'POSSIBLE_DIFFICULTY',
      ruleId: 'R2',
    });
  });

  it('gives R3 precedence over R5', () => {
    expect(
      compute({
        evidences: [
          activityEvidence('evidence-incorrect', 'INCORRECT'),
          activityEvidence('evidence-correct', 'CORRECT'),
          accessEvidence('evidence-access'),
        ],
      }),
    ).toMatchObject({
      state: 'NEEDS_PRACTICE',
      ruleId: 'R3',
    });
  });

  it('does not apply R5 to only ACCESS evidences', () => {
    expect(
      compute({
        evidences: [
          accessEvidence('evidence-access-1'),
          accessEvidence('evidence-access-2'),
        ],
      }),
    ).toMatchObject({
      state: 'IN_PROGRESS',
      ruleId: 'R6',
    });
  });

  it('does not apply R5 to a single correct activity', () => {
    expect(
      compute({
        evidences: [activityEvidence('evidence-correct', 'CORRECT')],
      }),
    ).toMatchObject({
      state: 'IN_PROGRESS',
      ruleId: 'R6',
    });
  });

  it('does not apply R4 when the concept has its own evidence', () => {
    expect(
      compute({
        evidences: [accessEvidence('evidence-access')],
        prerequisiteStates: ['POSSIBLE_DIFFICULTY'],
      }),
    ).toMatchObject({
      state: 'IN_PROGRESS',
      ruleId: 'R6',
    });
  });

  it('does not apply R2 when a later completed study session exists', () => {
    expect(
      compute({
        evidences: [transcriptEvidence('evidence-transcript')],
        studySessions: [
          studySession({
            status: 'DONE',
            scheduledFor: '2026-01-14T10:00:00.000Z',
          }),
        ],
      }),
    ).toMatchObject({
      state: 'IN_PROGRESS',
      ruleId: 'R6',
    });
  });

  it('includes consentRef in a transcript-based explanation', () => {
    const result = compute({
      evidences: [
        transcriptEvidence('evidence-transcript', {
          consentRef: 'consent-audit-fictional',
        }),
      ],
    });

    expect(result.explanation).toContain('consent-audit-fictional');
    expect(result.explanation).toMatch(
      /^Calculado por state-rules\/v1 R2: /,
    );
  });

  it('includes only evidence from the winning rule in evidenceIds', () => {
    expect(
      compute({
        evidences: [
          transcriptEvidence('evidence-transcript'),
          activityEvidence('evidence-incorrect', 'INCORRECT'),
          accessEvidence('evidence-access'),
        ],
      }).evidenceIds,
    ).toEqual(['evidence-transcript']);
  });
});
