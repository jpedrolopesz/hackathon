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

export interface PublishRecordingInput {
  readonly recordingId: string;
}

/**
 * `POST /recordings/{id}/publish` (seção 7 do README). Só o professor dono da turma
 * (ou ADMIN) pode publicar — mesma checagem de `assertClassOwner` usada em
 * `ScheduleLiveUseCase`. `RecordingRepository.publish` já garante
 * `ConditionExpression: status = READY` — aqui só resolve a gravação e autoriza.
 */
export class PublishRecordingUseCase {
  constructor(
    private readonly recordingRepository: RecordingRepository,
    private readonly liveSessionRepository: LiveSessionRepository,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: PublishRecordingInput,
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

    await this.recordingRepository.publish(input.recordingId);

    const updated = await this.recordingRepository.findById(input.recordingId);
    if (!updated) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `Recording ${input.recordingId} not found after publish`,
      );
    }
    return updated;
  }
}
