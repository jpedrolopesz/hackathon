import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import type { RecordingEventPatch, RecordingRepository } from '@/application/ports/RecordingRepository';
import { statusesThatCanTransitionTo } from '@/domain/value-objects/RecordingStatus';

export type CompositionStateChangeEventName =
  | 'Session Start'
  | 'Session End'
  | 'Session Failure'
  | 'Destination Start'
  | 'Destination End'
  | 'Destination Failure'
  | 'Destination Reconnecting';

export interface HandleIvsCompositionStateChangeEventInput {
  /** `detail.stage_arn` — para este detail-type, `resources[0]` é o ARN da
   * COMPOSIÇÃO, não do stage (docs/fase-1-arquitetura.md, seção 5/11). */
  readonly stageArn: string;
  readonly eventName: CompositionStateChangeEventName;
  /** Campo `time` do envelope do EventBridge — os exemplos oficiais de payload deste
   * detail-type não trazem `detail.event_time` (diferente de `IVS Stage Update`), só
   * o timestamp de nível superior do evento. */
  readonly eventTimeIso: string;
  readonly reason?: string;
}

/**
 * `IVS Composition State Change` (docs/fase-1-arquitetura.md, seção 5).
 * `Session Start` → `RECORDING`; `Session End` → `PROCESSING`; `Session
 * Failure`/`Destination Failure` → `FAILED`. `Destination Start`/`End`/
 * `Reconnecting` são no-ops explícitos (o destino aqui é sempre S3 único; nada no
 * fluxo de `Recording` depende do ciclo de vida do destino em si, só da sessão da
 * composição como um todo).
 */
export class HandleIvsCompositionStateChangeEventUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly recordingRepository: RecordingRepository,
  ) {}

  async execute(input: HandleIvsCompositionStateChangeEventInput): Promise<void> {
    if (
      input.eventName === 'Destination Start' ||
      input.eventName === 'Destination End' ||
      input.eventName === 'Destination Reconnecting'
    ) {
      return;
    }

    const live = await this.liveSessionRepository.findByStageArn(input.stageArn);
    if (!live?.activeRecordingId) {
      return; // sem gravação ativa conhecida para este stage — descartado.
    }

    const patch: RecordingEventPatch =
      input.eventName === 'Session Start'
        ? { status: 'RECORDING' }
        : input.eventName === 'Session End'
          ? { status: 'PROCESSING', endedAt: input.eventTimeIso }
          : { status: 'FAILED', errorMessage: input.reason ?? input.eventName };

    await this.recordingRepository.applyEvent(
      live.activeRecordingId,
      input.eventTimeIso,
      statusesThatCanTransitionTo(patch.status ?? 'FAILED'),
      patch,
    );
  }
}
