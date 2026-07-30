import type { RecordingConsent } from '@/domain/entities/RecordingConsent';

export interface RecordingConsentRepository {
  findActiveConsent(
    institutionId: string,
    liveSessionId: string,
    participantUserId: string,
    atInstant: string,
  ): Promise<RecordingConsent | null>;
}
