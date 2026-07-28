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
  /** Padrão de acesso #4 do README — lives de uma turma, ordenadas por horário (GSI1). */
  listByClass(classId: string): Promise<readonly LiveSession[]>;
  create(live: LiveSession): Promise<void>;
  transitionStatus(
    liveId: string,
    expectedStatus: LiveStatus,
    nextStatus: LiveStatus,
  ): Promise<void>;
  attachStage(liveId: string, expectedStatus: LiveStatus, stageArn: string): Promise<void>;
  /** Edição de título/descrição/horário (seção 13 do README) — só chamado pelo
   * use-case quando a live ainda está em `DRAFT`/`SCHEDULED` (nunca depois que o
   * Stage já foi provisionado), então não precisa de ConditionExpression por status:
   * essa regra já foi decidida antes de chegar aqui. */
  updateDetails(
    liveId: string,
    details: { readonly title: string; readonly description?: string; readonly scheduledStartAt: string },
  ): Promise<void>;
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
