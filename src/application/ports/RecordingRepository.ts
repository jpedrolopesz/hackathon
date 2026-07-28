import type { Recording, RecordingVisibility } from '@/domain/entities/Recording';
import type { RecordingStatus } from '@/domain/value-objects/RecordingStatus';

export interface RecordingPage {
  readonly recordings: readonly Recording[];
  readonly nextCursor?: string;
}

export type ApplyRecordingEventResult = 'applied' | 'stale' | 'not_found';

export type RecordingEventPatch = Partial<
  Pick<
    Recording,
    | 'status'
    | 'compositionArn'
    | 's3Prefix'
    | 'manifestPath'
    | 'cloudFrontPath'
    | 'durationSeconds'
    | 'endedAt'
    | 'errorMessage'
  >
>;

export interface RecordingRepository {
  /** `ConditionExpression: attribute_not_exists(PK)` — nunca sobrescreve uma gravação
   * já existente com o mesmo `recordingId`. */
  create(recording: Recording): Promise<void>;
  /** Via GSI2 (`GSI2PK=RECORDING#{recordingId}`) — o único dado que o consumidor de
   * EventBridge tem de antemão. */
  findById(recordingId: string): Promise<Recording | null>;
  findByCourse(courseId: string, pageSize: number, cursor?: string): Promise<RecordingPage>;
  /**
   * Aplica `patch` só se AMBAS as guardas passarem: (1) `eventTimeIso` mais recente
   * que o `lastEventTime` já registrado (entrega de eventos do IVS é best-effort,
   * pode chegar fora de ordem — docs/fase-1-arquitetura.md, seção 5); (2) o status
   * atual está em `expectedFromStatuses` (a própria máquina de estados — impede um
   * evento "de volta no tempo" só porque tecnicamente tem `event_time` maior mas
   * chegou depois de um evento de um estágio posterior já ter avançado o registro).
   * Nunca lança por evento atrasado/duplicado — retorna `'stale'`.
   */
  applyEvent(
    recordingId: string,
    eventTimeIso: string,
    expectedFromStatuses: readonly RecordingStatus[],
    patch: RecordingEventPatch,
  ): Promise<ApplyRecordingEventResult>;
  /** Ação humana (`POST /recordings/{id}/publish`), não gatilhada por evento — por
   * isso não passa pela guarda de `event_time`. `ConditionExpression: status = READY`. */
  publish(recordingId: string): Promise<void>;
  /** Idem, `ConditionExpression: status = READY`, transita para `HIDDEN`. */
  hide(recordingId: string): Promise<void>;
}

export type { RecordingVisibility };
