import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import type { RecordingEventPatch, RecordingRepository } from '@/application/ports/RecordingRepository';
import { statusesThatCanTransitionTo } from '@/domain/value-objects/RecordingStatus';

export type ParticipantRecordingStateChangeEventName =
  | 'Recording Start'
  | 'Recording End'
  | 'Recording Start Failure'
  | 'Recording End Failure';

export interface HandleIvsParticipantRecordingStateChangeEventInput {
  /** `resources[0]` é o ARN do STAGE para este detail-type (docs/fase-1-
   * arquitetura.md, seção 5/11) — sem `stage_arn` dentro de `detail`. */
  readonly stageArn: string;
  readonly eventName: ParticipantRecordingStateChangeEventName;
  readonly eventTimeIso: string;
  readonly recordingS3KeyPrefix?: string;
  readonly recordingDurationMs?: number;
  readonly reason?: string;
}

// Nome de arquivo convencional do manifesto HLS composto — a doc oficial de exemplos
// deste detail-type documenta `recording_s3_key_prefix`/`recording_duration_ms` para
// gravação INDIVIDUAL por participante, não a composição server-side em si (cujo
// prefixo real já é capturado em `Recording.s3Prefix` no momento do
// `StartComposition`, ver `HandleIvsStageUpdateEventUseCase`). Reaproveitamos esses
// campos como o sinal de finalização/duração porque é o que o desenho da Fase 1
// (docs/fase-1-arquitetura.md, seção 5) especifica para fechar a máquina de estados —
// registrado aqui como simplificação herdada, não uma verificação nova.
const COMPOSITE_MANIFEST_FILE_NAME = 'master.m3u8';

/**
 * `IVS Participant Recording State Change`. `Recording Start` é no-op explícito — o
 * status `RECORDING` já é alcançado via `Session Start` (Composition State Change);
 * aplicar de novo aqui só criaria uma corrida entre dois consumidores tentando a
 * mesma transição. `Recording End` fecha a gravação (`READY`, com
 * `manifestPath`/`durationSeconds`); `*Failure` marca `FAILED`. Em ambos os casos
 * terminais, limpa `LiveSession.activeRecordingId` — é isso que permite um futuro
 * `Participant Published` iniciar uma composição nova (decisão de auto-shutdown,
 * seção 11 dos docs).
 */
export class HandleIvsParticipantRecordingStateChangeEventUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly recordingRepository: RecordingRepository,
  ) {}

  async execute(input: HandleIvsParticipantRecordingStateChangeEventInput): Promise<void> {
    if (input.eventName === 'Recording Start') {
      return;
    }

    const live = await this.liveSessionRepository.findByStageArn(input.stageArn);
    if (!live?.activeRecordingId) {
      return;
    }
    const recordingId = live.activeRecordingId;

    const durationSeconds =
      input.recordingDurationMs !== undefined
        ? Math.round(input.recordingDurationMs / 1000)
        : undefined;
    const manifestPath = input.recordingS3KeyPrefix
      ? `${input.recordingS3KeyPrefix}/${COMPOSITE_MANIFEST_FILE_NAME}`
      : undefined;

    const patch: RecordingEventPatch =
      input.eventName === 'Recording End'
        ? {
            status: 'READY',
            ...(manifestPath !== undefined ? { manifestPath, cloudFrontPath: manifestPath } : {}),
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
          }
        : { status: 'FAILED', errorMessage: input.reason ?? input.eventName };

    const result = await this.recordingRepository.applyEvent(
      recordingId,
      input.eventTimeIso,
      statusesThatCanTransitionTo(patch.status ?? 'FAILED'),
      patch,
    );

    if (result === 'applied') {
      await this.liveSessionRepository.clearActiveRecording(live.liveId, recordingId);
    }
  }
}
