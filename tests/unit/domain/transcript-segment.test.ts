import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/domain/entities/TranscriptSegment';

describe('TranscriptSegment', () => {
  it('represents a timestamped segment with a speaker label', () => {
    const segment: TranscriptSegment = {
      id: 'segment-question',
      transcriptId: 'transcript-statistics',
      institutionId: 'institution-fictional',
      speakerLabel: 'speaker-2',
      speakerRole: 'ALUNO',
      startMs: 1_200,
      endMs: 4_800,
      text: 'Qual é a diferença entre média e mediana?',
      consentRef: 'consent-fictional',
    };

    expect(segment.speakerRole).toBe('ALUNO');
    expect(segment.endMs).toBeGreaterThan(segment.startMs);
  });
});
