import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { assertSameInstitution } from '@/application/authorization/guards';
import type { RecordingConsentRepository } from '@/application/ports/RecordingConsentRepository';
import {
  evaluateRecordingConsent,
  type RecordingConsentEvaluation,
} from '@/domain/services/evaluate-recording-consent';

export type { RecordingConsentDeniedReason } from '@/domain/services/evaluate-recording-consent';
export type RecordingConsentResult = RecordingConsentEvaluation;

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

    return evaluateRecordingConsent(consent, input.atInstant);
  }
}
