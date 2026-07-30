import { describe, expect, it } from 'vitest';
import type { DetectedQuestion } from '@/domain/entities/DetectedQuestion';

describe('DetectedQuestion', () => {
  it('represents a question detected from consented transcript segments', () => {
    const question: DetectedQuestion = {
      id: 'question-media-mediana',
      institutionId: 'institution-fictional',
      userId: 'user-fictional',
      transcriptId: 'transcript-statistics',
      disciplineId: 'discipline-statistics',
      segmentIds: ['segment-question'],
      summary: 'Diferença entre média e mediana',
      detectedAt: '2026-01-12T12:31:00.000Z',
      consentRef: 'consent-fictional',
    };

    expect(question.segmentIds).toEqual(['segment-question']);
    expect(question.userId).toBe('user-fictional');
    expect(question.consentRef).toBe('consent-fictional');
  });
});
