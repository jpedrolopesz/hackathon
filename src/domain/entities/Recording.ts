import type { RecordingStatus } from '../value-objects/RecordingStatus';

export type RecordingVisibility = 'DRAFT' | 'PUBLISHED';

/**
 * Chave: PK=COURSE#{courseId}, SK=RECORDING#{startedAt}#{recordingId} (padrão de
 * acesso #9 — listar gravações de uma disciplina, ordenado por início).
 * GSI2PK=RECORDING#{recordingId} / GSI2SK=RECORDING#{recordingId} para lookup direto
 * por ID (o consumidor de EventBridge só tem `recordingId`, nunca `courseId`/
 * `startedAt` de antemão — ver docs/fase-1-arquitetura.md, seção 11).
 *
 * `manifestPath` e `cloudFrontPath` guardam o MESMO valor neste desenho — o
 * CloudFront serve o bucket 1:1 via Origin Access Control, sem remapeamento de
 * caminho, então não há um "caminho do CDN" distinto do caminho do objeto no S3. Os
 * dois campos existem porque a seção 7 do README pede ambos explicitamente; unificar
 * um no outro seria contrariar o enunciado sem ganho real.
 */
export interface Recording {
  readonly recordingId: string;
  readonly liveId: string;
  readonly courseId: string;
  readonly institutionId: string;
  readonly stageArn: string;
  readonly compositionArn?: string;
  readonly s3Prefix?: string;
  readonly manifestPath?: string;
  readonly cloudFrontPath?: string;
  readonly durationSeconds?: number;
  readonly status: RecordingStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly errorMessage?: string;
  readonly visibility: RecordingVisibility;
  /**
   * `event_time` (ISO 8601) do último evento do EventBridge aplicado — guarda de
   * ordem, não um campo de negócio exposto ao cliente. A entrega de eventos do IVS é
   * best-effort (pode faltar, atrasar ou chegar fora de ordem — docs/fase-1-
   * arquitetura.md, seção 5); toda transição condiciona nisto, não só no status
   * esperado.
   */
  readonly lastEventTime?: string;
}
