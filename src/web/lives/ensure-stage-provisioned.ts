import 'server-only';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { useCases } from '@/web/container';
import { getEnv } from '@/shared/config/env';

/**
 * "Disparado ao abrir a sala de espera" (`ProvisionLiveStageUseCase`, ver seção 9/12
 * do docs/fase-1-arquitetura.md) — o PRIMEIRO acesso do professor ao estúdio é esse
 * gatilho, não um botão separado. `ProvisionLiveStageUseCase` não recebe
 * `AuthenticatedRequestContext` (é acionável também por rotina automatizada, fora do
 * escopo desta fase) — por isso a checagem de posse (`getOwnedLive`) precisa
 * acontecer ANTES de chamar isto, no caller, nunca depois.
 */
export async function ensureStageProvisioned(live: LiveSession): Promise<LiveSession> {
  if (live.status !== 'SCHEDULED') {
    return live;
  }
  return useCases.provisionLiveStage.execute(live.liveId, getEnv().APP_ENV);
}
