import { describe, expect, it } from 'vitest';
import type { RecordingConsent } from '@/domain/entities/RecordingConsent';

describe('RecordingConsent', () => {
  it('represents an active consent with declared purposes', () => {
    const consent: RecordingConsent = {
      id: 'consent-fictional',
      institutionId: 'institution-fictional',
      liveSessionId: 'live-statistics',
      participantUserId: 'user-fictional',
      purposes: ['TRANSCRIPTION', 'EDUCATIONAL_GUIDANCE'],
      grantedAt: '2026-01-12T09:00:00.000Z',
      validFrom: '2026-01-12T09:00:00.000Z',
      validUntil: '2026-01-12T12:00:00.000Z',
      revokedAt: null,
      status: 'ACTIVE',
    };

    expect(consent.status).toBe('ACTIVE');
    expect(consent.revokedAt).toBeNull();
  });
});
