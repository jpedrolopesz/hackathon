import {
  assertClassOwner,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { emitMetric } from '@/shared/observability/structured-log';

/**
 * Nenhuma chamada à API do IVS aqui: o Stage já existe (`ProvisionLiveStageUseCase`
 * rodou antes, fora do pico de `/start` — ver docs/fase-1-arquitetura.md seção 9).
 * `/start` é só uma transição de estado no DynamoDB (`WAITING` -> `LIVE`), idempotente
 * via `ConditionExpression` sobre a leitura forte do padrão de acesso #6.
 */
export class StartLiveUseCase {
  constructor(private readonly liveSessionRepository: LiveSessionRepository) {}

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

    if (live.status === 'LIVE') {
      return live;
    }

    if (!live.stageArn) {
      throw new ConflictError(
        'A sala ainda não está pronta. Tente novamente em instantes.',
        'STAGE_NOT_PROVISIONED',
        `LiveSession ${liveId} has no stageArn yet (status=${live.status})`,
      );
    }

    await this.liveSessionRepository.transitionStatus(liveId, 'WAITING', 'LIVE');
    emitMetric('LivesStarted');

    const updated = await this.liveSessionRepository.findById(liveId);
    if (!updated) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${liveId} not found after start`,
      );
    }
    return updated;
  }
}
