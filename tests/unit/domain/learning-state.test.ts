import { describe, expect, it } from 'vitest';
import type { LearningState } from '@/domain/entities/LearningState';

describe('LearningState', () => {
  it('represents an auditable state of a concept', () => {
    const learningState: LearningState = {
      institutionId: 'institution-fictional',
      userId: 'user-fictional',
      disciplineId: 'discipline-statistics',
      conceptId: 'concept-mediana',
      state: 'IN_PROGRESS',
      explanation: 'Existem evidências de trabalho em andamento sobre o conceito.',
      ruleVersion: 'rule-fictional',
      evidenceIds: ['evidence-fictional'],
      computedAt: '2026-01-12T12:32:00.000Z',
    };

    expect(learningState.state).toBe('IN_PROGRESS');
    expect(learningState.ruleVersion).toBe('rule-fictional');
  });
});
