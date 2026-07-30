import { describe, expect, it } from 'vitest';
import type { RecordingConsent } from '@/domain/entities/RecordingConsent';
import { evaluateRecordingConsent } from '@/domain/services/evaluate-recording-consent';

const atInstant = '2026-01-12T10:00:00.000Z';

function consent(
  overrides: Partial<RecordingConsent> = {},
): RecordingConsent {
  return {
    id: 'consent-fictional',
    institutionId: 'institution-fictional',
    liveSessionId: 'live-statistics',
    participantUserId: 'participant-fictional',
    purposes: ['TRANSCRIPTION'],
    grantedAt: '2026-01-12T08:00:00.000Z',
    validFrom: '2026-01-12T09:00:00.000Z',
    validUntil: '2026-01-12T11:00:00.000Z',
    revokedAt: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('evaluateRecordingConsent', () => {
  it('denies when no consent exists', () => {
    expect(evaluateRecordingConsent(null, atInstant)).toEqual({
      allowed: false,
      reason: 'NO_CONSENT',
    });
  });

  it('denies a consent with REVOKED status', () => {
    expect(
      evaluateRecordingConsent(consent({ status: 'REVOKED' }), atInstant),
    ).toEqual({
      allowed: false,
      reason: 'REVOKED',
    });
  });

  it('denies a consent with revokedAt set', () => {
    expect(
      evaluateRecordingConsent(
        consent({ revokedAt: '2026-01-12T09:30:00.000Z' }),
        atInstant,
      ),
    ).toEqual({
      allowed: false,
      reason: 'REVOKED',
    });
  });

  it('denies a consent whose validUntil is in the past', () => {
    expect(
      evaluateRecordingConsent(
        consent({ validUntil: '2026-01-12T09:59:59.000Z' }),
        atInstant,
      ),
    ).toEqual({
      allowed: false,
      reason: 'EXPIRED',
    });
  });

  it('denies a consent whose validFrom is in the future', () => {
    expect(
      evaluateRecordingConsent(
        consent({ validFrom: '2026-01-12T10:00:01.000Z' }),
        atInstant,
      ),
    ).toEqual({
      allowed: false,
      reason: 'NOT_YET_VALID',
    });
  });

  it('allows a currently valid consent and returns its reference', () => {
    expect(evaluateRecordingConsent(consent(), atInstant)).toEqual({
      allowed: true,
      consentRef: 'consent-fictional',
    });
  });
});
