import type { LiveSession } from '@/domain/entities/LiveSession';
import type { LiveStatus } from '@/domain/value-objects/LiveStatus';

/**
 * `transitionStatus`/`attachStage` são escritas condicionais (padrão de acesso #6):
 * devem lançar `ConflictError` se o estado atual não bater com `expectedStatus` — é
 * assim que `start`/`finish`/`provisionStage` ficam idempotentes sob concorrência
 * (docs/fase-1-arquitetura.md, seção 9/10).
 */
export interface LiveSessionRepository {
  findById(liveId: string): Promise<LiveSession | null>;
  findByStageArn(stageArn: string): Promise<LiveSession | null>;
  create(live: LiveSession): Promise<void>;
  transitionStatus(
    liveId: string,
    expectedStatus: LiveStatus,
    nextStatus: LiveStatus,
  ): Promise<void>;
  attachStage(liveId: string, expectedStatus: LiveStatus, stageArn: string): Promise<void>;
  /**
   * Fase 7 — "reivindica" a gravação ativa da live: só escreve se `activeRecordingId`
   * estiver ausente OU igual a `expectedCurrentRecordingId` (uma gravação anterior já
   * terminal — READY/FAILED — sendo substituída por uma nova composição após o
   * auto-shutdown de 60s, docs/fase-1-arquitetura.md seção 5/12). Lança `ConflictError`
   * se outra chamada concorrente já reivindicou primeiro — o chamador deve reverter
   * (parar a composição recém-criada), mesmo padrão de "ordem de operações" da Fase 5.
   */
  claimActiveRecording(
    liveId: string,
    expectedCurrentRecordingId: string | undefined,
    newRecordingId: string,
  ): Promise<void>;
  /** Limpa `activeRecordingId` só se ainda apontar para `expectedRecordingId` — evita
   * limpar uma gravação NOVA que já substituiu a que está sendo finalizada. */
  clearActiveRecording(liveId: string, expectedRecordingId: string): Promise<void>;
}
