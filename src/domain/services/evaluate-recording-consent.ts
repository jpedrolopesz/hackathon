import type { RecordingConsent } from '@/domain/entities/RecordingConsent';

export type RecordingConsentDeniedReason =
  | 'NO_CONSENT'
  | 'REVOKED'
  | 'EXPIRED'
  | 'NOT_YET_VALID';

export type RecordingConsentEvaluation =
  | { readonly allowed: true; readonly consentRef: string }
  | {
      readonly allowed: false;
      readonly reason: RecordingConsentDeniedReason;
    };

export function evaluateRecordingConsent(
  consent: RecordingConsent | null,
  atInstant: string,
): RecordingConsentEvaluation {
  if (!consent) {
    return { allowed: false, reason: 'NO_CONSENT' };
  }
  if (consent.status === 'REVOKED' || consent.revokedAt !== null) {
    return { allowed: false, reason: 'REVOKED' };
  }
  if (consent.status === 'EXPIRED' || consent.validUntil < atInstant) {
    return { allowed: false, reason: 'EXPIRED' };
  }
  if (consent.validFrom > atInstant) {
    return { allowed: false, reason: 'NOT_YET_VALID' };
  }

  return { allowed: true, consentRef: consent.id };
}
