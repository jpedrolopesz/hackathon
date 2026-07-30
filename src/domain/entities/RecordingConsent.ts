export type RecordingConsentStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface RecordingConsent {
  readonly id: string;
  readonly institutionId: string;
  readonly liveSessionId: string;
  readonly participantUserId: string;
  readonly purposes: readonly string[];
  readonly grantedAt: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt: string | null;
  readonly status: RecordingConsentStatus;
}
