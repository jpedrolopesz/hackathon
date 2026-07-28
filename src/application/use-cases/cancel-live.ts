import {
  assertClassOwner,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { IvsRealTimeServicePort } from '@/application/ports/IvsRealTimeServicePort';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { LiveStatus } from '@/domain/value-objects/LiveStatus';

const CANCELABLE_STATUSES: readonly LiveStatus[] = ['DRAFT', 'SCHEDULED', 'WAITING'];

/**
 * Se a live já tinha Stage provisionado (estava em `WAITING`) mas nunca chegou a ficar
 * `LIVE`, cancelar precisa apagar o Stage — senão ele fica órfão para sempre (docs/
 * fase-1-arquitetura.md, seção 9, mesmo raciocínio do `FinishLive`).
 */
export class CancelLiveUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly ivsRealTimeService: IvsRealTimeServicePort,
  ) {}

  async execute(context: AuthenticatedRequestContext, liveId: string): Promise<LiveSession> {
    const live = await this.liveSessionRepository.findById(liveId);
    if (!live) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${liveId} not found`,
      );
    }

    assertSameInstitution(context, live.institutionId);
    assertClassOwner(context, live);

    if (live.status === 'CANCELED') {
      return live;
    }

    if (!CANCELABLE_STATUSES.includes(live.status)) {
      throw new ConflictError(
        'Essa aula não pode mais ser cancelada.',
        'INVALID_STATE_TRANSITION',
        `LiveSession ${liveId} cannot be canceled from status ${live.status}`,
      );
    }

    await this.liveSessionRepository.transitionStatus(liveId, live.status, 'CANCELED');

    if (live.stageArn) {
      await this.ivsRealTimeService.deleteStage(live.stageArn).catch((error: unknown) => {
        console.error('CancelLive: failed to delete orphaned stage; needs manual reconciliation', {
          liveId,
          stageArn: live.stageArn,
          error,
        });
      });
    }

    const updated = await this.liveSessionRepository.findById(liveId);
    if (!updated) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${liveId} not found after cancel`,
      );
    }
    return updated;
  }
}
