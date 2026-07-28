import type { LiveStatus } from '../value-objects/LiveStatus';

/**
 * Chave: PK=LIVE#{liveId}, SK=METADATA (padrão de acesso #6 — GetItem consistente).
 * GSI1PK=CLASS#{classId} / GSI1SK={scheduledStartAt}#{liveId} (padrão #4).
 * GSI2PK=STAGE#{stageArn} / GSI2SK=STAGE#{stageArn} (padrão #13), só depois que o
 * Stage é provisionado — antes disso o item não tem esses dois atributos.
 */
export interface LiveSession {
  readonly liveId: string;
  readonly classId: string;
  readonly institutionId: string;
  /** Denormalizado de `ClassGroup.teacherId` na criação — evita um lookup extra em
   * toda operação de live só para checar dono da turma (`assertClassOwner`). */
  readonly teacherId: string;
  readonly title: string;
  readonly scheduledStartAt: string;
  readonly status: LiveStatus;
  readonly stageArn?: string;
  readonly activeRecordingId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
