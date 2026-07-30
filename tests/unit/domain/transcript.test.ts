import { describe, expect, it } from 'vitest';
import type { Transcript } from '@/domain/entities/Transcript';

describe('Transcript', () => {
  it('requires the consent reference that authorized the transcript', () => {
    const transcript: Transcript = {
      id: 'transcript-statistics',
      institutionId: 'institution-fictional',
      liveSessionId: 'live-statistics',
      recordingId: 'recording-statistics',
      disciplineId: 'discipline-statistics',
      language: 'pt-BR',
      consentRef: 'consent-fictional',
      status: 'COMPLETED',
      createdAt: '2026-01-12T12:30:00.000Z',
    };

    expect(transcript.consentRef).toBe('consent-fictional');
    expect(transcript.status).toBe('COMPLETED');
  });
});
