import {
  assertClassOwner,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { IvsRealTimeServicePort } from '@/application/ports/IvsRealTimeServicePort';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { emitMetric } from '@/shared/observability/structured-log';

/**
 * `LIVE` -> `ENDING` -> `ENDED`. `DeleteStage` (seção 9 do README/docs) limpa o
 * recurso no encerramento — se falhar, não bloqueia o encerramento nem volta o estado
 * (a live já acabou de verdade); fica registrado para a rotina de reconciliação de
 * Stages órfãos (documentada, não implementada nesta fase).
 */
export class FinishLiveUseCase {
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

    if (live.status === 'ENDED' || live.status === 'ENDING') {
      return live;
    }

    await this.liveSessionRepository.transitionStatus(liveId, 'LIVE', 'ENDING');

    if (live.stageArn) {
      await this.ivsRealTimeService.deleteStage(live.stageArn).catch((error: unknown) => {
        console.error('FinishLive: failed to delete stage; needs manual reconciliation', {
          liveId,
          stageArn: live.stageArn,
          error,
        });
      });
    }

    await this.liveSessionRepository.transitionStatus(liveId, 'ENDING', 'ENDED');
    emitMetric('LivesEnded');

    const updated = await this.liveSessionRepository.findById(liveId);
    if (!updated) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${liveId} not found after finish`,
      );
    }
    return updated;
  }
}
