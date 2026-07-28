import {
  assertClassOwner,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import type { RecordingRepository } from '@/application/ports/RecordingRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { Recording } from '@/domain/entities/Recording';

export interface HideRecordingInput {
  readonly recordingId: string;
}

/**
 * `POST /recordings/{id}/hide` (seção 7 do README). Ocultar não apaga o objeto do S3
 * — só para de emitir URLs assinadas (docs/fase-1-arquitetura.md, seção 5); é por
 * isso que `RecordingRepository.hide` só muda `status` para `HIDDEN`, nunca toca o
 * S3/CloudFront.
 */
export class HideRecordingUseCase {
  constructor(
    private readonly recordingRepository: RecordingRepository,
    private readonly liveSessionRepository: LiveSessionRepository,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: HideRecordingInput,
  ): Promise<Recording> {
    const recording = await this.recordingRepository.findById(input.recordingId);
    if (!recording) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `Recording ${input.recordingId} not found`,
      );
    }
    assertSameInstitution(context, recording.institutionId);

    const live = await this.liveSessionRepository.findById(recording.liveId);
    if (!live) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${recording.liveId} not found for recording ${input.recordingId}`,
      );
    }
    assertClassOwner(context, live);

    await this.recordingRepository.hide(input.recordingId);

    const updated = await this.recordingRepository.findById(input.recordingId);
    if (!updated) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `Recording ${input.recordingId} not found after hide`,
      );
    }
    return updated;
  }
}
