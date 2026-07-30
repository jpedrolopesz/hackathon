import { describe, expect, it } from 'vitest';
import type { StudySession } from '@/domain/entities/StudySession';

describe('StudySession', () => {
  it('represents a planned study session created from a recommendation', () => {
    const session: StudySession = {
      id: 'study-session-fictional',
      institutionId: 'institution-fictional',
      userId: 'user-fictional',
      disciplineId: 'discipline-statistics',
      conceptId: 'concept-mediana',
      recommendationId: 'recommendation-fictional',
      scheduledFor: '2026-01-13T09:00:00.000Z',
      durationMinutes: 30,
      status: 'PLANNED',
      createdAt: '2026-01-12T12:34:00.000Z',
    };

    expect(session.status).toBe('PLANNED');
    expect(session.recommendationId).toBe('recommendation-fictional');
  });
});
