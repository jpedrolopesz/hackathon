import {
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { IvsRealTimeServicePort } from '@/application/ports/IvsRealTimeServicePort';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { LiveSession } from '@/domain/entities/LiveSession';

/**
 * Cria o Stage do IVS ANTES da hora agendada — nunca no `/start` (docs/fase-1-
 * arquitetura.md, seção 9): `CreateStage` é 5 TPS, fixo, não ajustável; 40 professores
 * iniciando aula na mesma hora cheia estourariam a cota se o Stage fosse criado ali.
 * Disparado ao abrir a sala de espera (`SCHEDULED` -> `WAITING`) — chamado pelo
 * primeiro acesso à sala de espera ou por uma rotina agendada (não implementada nesta
 * fase; ver riscos).
 *
 * Ordem das operações (evita Stage órfão — a escrita condicional no DynamoDB não
 * protege o recurso na AWS, só o estado):
 * 1. Reserva a transição (`SCHEDULED` -> `WAITING`) ANTES de tocar em qualquer recurso
 *    AWS. Se isso falhar (corrida concorrente), nada foi criado, nada para limpar.
 * 2. Só então cria o Stage.
 * 3. Grava o `stageArn` com update condicional.
 * 4. Se (2) ou (3) falharem — inclusive por `ServiceUnavailableError`/throttling —
 *    reverte para `SCHEDULED` (nunca para `FAILED`: throttling não é falha real) e
 *    relança. Uma falha na própria reversão fica para reconciliação (não implementada
 *    nesta fase; registrado como risco).
 */
export class ProvisionLiveStageUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly ivsRealTimeService: IvsRealTimeServicePort,
  ) {}

  async execute(liveId: string, environment: string): Promise<LiveSession> {
    const live = await this.liveSessionRepository.findById(liveId);
    if (!live) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${liveId} not found`,
      );
    }

    if (live.status === 'WAITING' && live.stageArn) {
      return live;
    }

    await this.liveSessionRepository.transitionStatus(liveId, 'SCHEDULED', 'WAITING');

    try {
      const stage = await this.ivsRealTimeService.createStage({
        name: `live-${liveId}`,
        tags: { Environment: environment, LiveId: liveId },
      });

      await this.liveSessionRepository.attachStage(liveId, 'WAITING', stage.stageArn);
    } catch (error) {
      await this.liveSessionRepository
        .transitionStatus(liveId, 'WAITING', 'SCHEDULED')
        .catch((revertError: unknown) => {
          console.error(
            'ProvisionLiveStage: failed to revert WAITING -> SCHEDULED after a failed provisioning attempt; needs manual reconciliation',
            { liveId, revertError },
          );
        });
      throw error;
    }

    const updated = await this.liveSessionRepository.findById(liveId);
    if (!updated) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${liveId} not found after provisioning`,
      );
    }
    return updated;
  }
}
