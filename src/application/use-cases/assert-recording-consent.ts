import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { assertSameInstitution } from '@/application/authorization/guards';
import type { RecordingConsentRepository } from '@/application/ports/RecordingConsentRepository';

export type RecordingConsentDeniedReason =
  | 'NO_CONSENT'
  | 'REVOKED'
  | 'EXPIRED'
  | 'NOT_YET_VALID';

export type RecordingConsentResult =
  | { readonly allowed: true; readonly consentRef: string }
  | { readonly allowed: false; readonly reason: RecordingConsentDeniedReason };

export interface AssertRecordingConsentInput {
  readonly institutionId: string;
  readonly liveSessionId: string;
  readonly participantUserId: string;
  readonly atInstant: string;
}

export class AssertRecordingConsentUseCase {
  constructor(private readonly recordingConsentRepository: RecordingConsentRepository) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: AssertRecordingConsentInput,
  ): Promise<RecordingConsentResult> {
    try {
      assertSameInstitution(context, input.institutionId);
    } catch {
      return { allowed: false, reason: 'NO_CONSENT' };
    }

    const consent = await this.recordingConsentRepository.findActiveConsent(
      input.institutionId,
      input.liveSessionId,
      input.participantUserId,
      input.atInstant,
    );

    if (!consent) {
      return { allowed: false, reason: 'NO_CONSENT' };
    }
    if (consent.status === 'REVOKED' || consent.revokedAt !== null) {
      return { allowed: false, reason: 'REVOKED' };
    }
    if (consent.status === 'EXPIRED' || consent.validUntil < input.atInstant) {
      return { allowed: false, reason: 'EXPIRED' };
    }
    if (consent.validFrom > input.atInstant) {
      return { allowed: false, reason: 'NOT_YET_VALID' };
    }

    return { allowed: true, consentRef: consent.id };
  }
}
