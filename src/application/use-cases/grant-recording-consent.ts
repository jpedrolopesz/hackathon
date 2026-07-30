import { ulid } from 'ulid';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { assertSameInstitution } from '@/application/authorization/guards';
import type { RecordingConsentRepository } from '@/application/ports/RecordingConsentRepository';
import type { RecordingConsent } from '@/domain/entities/RecordingConsent';
import { ValidationError } from '@/domain/errors/ValidationError';

export interface GrantRecordingConsentInput {
  readonly institutionId: string;
  readonly liveSessionId: string;
  readonly participantUserId: string;
  readonly purposes: readonly string[];
  readonly grantedAt: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

export class GrantRecordingConsentUseCase {
  constructor(private readonly recordingConsentRepository: RecordingConsentRepository) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: GrantRecordingConsentInput,
  ): Promise<RecordingConsent> {
    assertSameInstitution(context, input.institutionId);

    if (input.purposes.length === 0) {
      throw new ValidationError(
        'O consentimento precisa declarar ao menos uma finalidade.',
        'CONSENT_PURPOSES_REQUIRED',
        [{ path: 'purposes', message: 'informe ao menos uma finalidade' }],
      );
    }

    if (input.validUntil <= input.validFrom) {
      throw new ValidationError(
        'O fim da vigência precisa ser posterior ao início.',
        'CONSENT_VALIDITY_INVALID',
        [{ path: 'validUntil', message: 'deve ser posterior a validFrom' }],
      );
    }

    const consent: RecordingConsent = {
      id: ulid(),
      institutionId: input.institutionId,
      liveSessionId: input.liveSessionId,
      participantUserId: input.participantUserId,
      purposes: input.purposes,
      grantedAt: input.grantedAt,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      revokedAt: null,
      status: 'ACTIVE',
    };

    await this.recordingConsentRepository.save(consent);
    return consent;
  }
}
