import type { LiveStatus } from '@/domain/value-objects/LiveStatus';
import type { RecordingStatus } from '@/domain/value-objects/RecordingStatus';

/** Rótulos em português — nomes de status no código continuam em inglês (seção 13
 * do README: "textos de interface em português, nomes no código em inglês"). */
export const LIVE_STATUS_LABELS: Record<LiveStatus, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  WAITING: 'Sala de espera',
  LIVE: 'Ao vivo',
  ENDING: 'Encerrando',
  ENDED: 'Encerrada',
  CANCELED: 'Cancelada',
  FAILED: 'Falhou',
};

export const RECORDING_STATUS_LABELS: Record<RecordingStatus, string> = {
  PENDING: 'Aguardando início',
  STARTING: 'Iniciando',
  RECORDING: 'Gravando',
  PROCESSING: 'Processando',
  READY: 'Pronta',
  FAILED: 'Falhou',
  HIDDEN: 'Oculta',
};
