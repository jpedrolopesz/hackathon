export type RecordingStatus =
  'PENDING' | 'STARTING' | 'RECORDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'HIDDEN';

/**
 * Seção 7 do README. `HIDDEN` só é alcançável a partir de `READY` (ação humana do
 * professor, `HideRecordingUseCase` — não gatilhada por evento do EventBridge, por
 * isso não passa pela guarda de `event_time` de `RecordingRepository.applyEvent`).
 * `FAILED` é terminal: uma vez que a composição falhou, não há retomada automática
 * (decisão da Fase 7, seção 10 dos docs — nova gravação é uma nova composição, com
 * novo `recordingId`).
 */
const ALLOWED_TRANSITIONS: Record<RecordingStatus, readonly RecordingStatus[]> = {
  PENDING: ['STARTING', 'FAILED'],
  STARTING: ['RECORDING', 'FAILED'],
  RECORDING: ['PROCESSING', 'FAILED'],
  PROCESSING: ['READY', 'FAILED'],
  READY: ['HIDDEN'],
  FAILED: [],
  HIDDEN: [],
};

export function canTransitionRecordingStatus(from: RecordingStatus, to: RecordingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

const ALL_STATUSES = Object.keys(ALLOWED_TRANSITIONS) as readonly RecordingStatus[];

/** Usado para montar o `ConditionExpression` de `RecordingRepository.applyEvent` — só
 * aplica um evento se o status atual estiver entre os que legitimamente transitam
 * para o alvo (além da guarda de `event_time`). */
export function statusesThatCanTransitionTo(to: RecordingStatus): readonly RecordingStatus[] {
  return ALL_STATUSES.filter((from) => ALLOWED_TRANSITIONS[from].includes(to));
}
