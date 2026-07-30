import { describe, expect, it } from 'vitest';
import type { LearningEvidence } from '@/domain/entities/LearningEvidence';

const baseEvidence = {
  id: 'evidence-fictional',
  institutionId: 'institution-fictional',
  userId: 'user-fictional',
  disciplineId: 'discipline-statistics',
  conceptId: 'concept-mediana',
  occurredAt: '2026-01-12T12:31:00.000Z',
  sourceRef: 'segment-question',
} as const;

describe('LearningEvidence', () => {
  it('represents transcript evidence with mandatory consentRef', () => {
    const evidence: LearningEvidence = {
      ...baseEvidence,
      origin: 'TRANSCRIPT',
      consentRef: 'consent-fictional',
    };

    expect(evidence.origin).toBe('TRANSCRIPT');
    expect(evidence.consentRef).toBe('consent-fictional');
  });

  it('allows activity and access evidence without consentRef', () => {
    const activity: LearningEvidence = { ...baseEvidence, origin: 'ACTIVITY' };
    const access: LearningEvidence = {
      ...baseEvidence,
      id: 'evidence-access-fictional',
      origin: 'ACCESS',
      sourceRef: 'material-central-tendency',
    };

    expect(activity.origin).toBe('ACTIVITY');
    expect(access.origin).toBe('ACCESS');
  });

  it('represents an incorrect observed activity result', () => {
    const evidence: LearningEvidence = {
      ...baseEvidence,
      origin: 'ACTIVITY',
      result: 'INCORRECT',
    };

    expect(evidence.result).toBe('INCORRECT');
  });

  it('represents a correct observed activity result', () => {
    const evidence: LearningEvidence = {
      ...baseEvidence,
      origin: 'ACTIVITY',
      result: 'CORRECT',
    };

    expect(evidence.result).toBe('CORRECT');
  });

  it('rejects transcript evidence without consentRef at compile time', () => {
    // @ts-expect-error TRANSCRIPT requires the consent that authorized the derived datum.
    const evidence: LearningEvidence = { ...baseEvidence, origin: 'TRANSCRIPT' };

    expect(evidence.origin).toBe('TRANSCRIPT');
  });
});
