export type LiveStatus =
  'DRAFT' | 'SCHEDULED' | 'WAITING' | 'LIVE' | 'ENDING' | 'ENDED' | 'CANCELED' | 'FAILED';

/**
 * Seção 10 do README. `WAITING` é onde o Stage é provisionado (ver
 * docs/fase-1-arquitetura.md, seção 5/9 — CreateStage sai do `/start` por causa da
 * cota fixa de 5 TPS). `/start` só ativa (`WAITING` -> `LIVE`) um Stage que já existe.
 */
const ALLOWED_TRANSITIONS: Record<LiveStatus, readonly LiveStatus[]> = {
  DRAFT: ['SCHEDULED', 'CANCELED'],
  SCHEDULED: ['WAITING', 'CANCELED'],
  WAITING: ['LIVE', 'CANCELED', 'FAILED'],
  LIVE: ['ENDING', 'FAILED'],
  ENDING: ['ENDED', 'FAILED'],
  ENDED: [],
  CANCELED: [],
  FAILED: [],
};

export function canTransitionLiveStatus(from: LiveStatus, to: LiveStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
