import { describe, expect, it } from 'vitest';
import type { Recommendation } from '@/domain/entities/Recommendation';

describe('Recommendation', () => {
  it('represents a proposed recommendation citing official materials', () => {
    const recommendation: Recommendation = {
      id: 'recommendation-fictional',
      institutionId: 'institution-fictional',
      userId: 'user-fictional',
      disciplineId: 'discipline-statistics',
      conceptId: 'concept-mediana',
      detectedQuestionId: 'question-media-mediana',
      guidanceText: 'Revise as definições de média e mediana no material indicado.',
      citedMaterialIds: ['material-central-tendency'],
      status: 'PROPOSED',
      proposedAt: '2026-01-12T12:33:00.000Z',
      decidedAt: null,
    };

    expect(recommendation.status).toBe('PROPOSED');
    expect(recommendation.decidedAt).toBeNull();
  });
});
