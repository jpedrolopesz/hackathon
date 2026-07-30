import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type {
  AssertRecordingConsentInput,
  RecordingConsentResult,
} from '@/application/use-cases/assert-recording-consent';
import type { AssertRecordingConsentUseCase } from '@/application/use-cases/assert-recording-consent';
import { structuredLog } from '@/shared/observability/structured-log';

export interface ConsentGateInput extends AssertRecordingConsentInput {}

export async function consentGate(
  assertRecordingConsent: AssertRecordingConsentUseCase,
  context: AuthenticatedRequestContext,
  input: ConsentGateInput,
): Promise<RecordingConsentResult> {
  const result = await assertRecordingConsent.execute(context, input);

  if (!result.allowed) {
    structuredLog('info', {
      event: 'recording_consent.gate',
      institutionId: context.institutionId,
      liveSessionId: input.liveSessionId,
      participantUserId: input.participantUserId,
      reason: result.reason,
      decision: 'DISCARDED',
      decisionTimestamp: new Date().toISOString(),
    });
  }

  return result;
}
