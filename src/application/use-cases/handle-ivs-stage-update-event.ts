import { randomUUID } from 'node:crypto';
import type { ClassGroupRepository } from '@/application/ports/ClassGroupRepository';
import type { IvsRealTimeServicePort } from '@/application/ports/IvsRealTimeServicePort';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import type { RecordingRepository } from '@/application/ports/RecordingRepository';
import type { Recording } from '@/domain/entities/Recording';

export interface HandleIvsStageUpdateEventInput {
  readonly stageArn: string;
  readonly eventName: 'Participant Published' | 'Participant Unpublished';
  readonly encoderConfigurationArn: string;
  readonly storageConfigurationArn: string;
  readonly environmentTag: string;
}

/**
 * `IVS Stage Update` (docs/fase-1-arquitetura.md, seção 5) — `resources[0]` é o ARN
 * do stage (resolvido pelo handler antes de chamar este use-case).
 *
 * Decisão de Fase 7 sobre o auto-shutdown de 60s sem publisher (seção 8 dos docs,
 * "em aberto" até agora — ver seção 11): quando o professor reconecta depois de uma
 * queda maior que 60s, a composição antiga já morreu (STOPPED, deletada pelo
 * próprio IVS) — não há como "retomar" a mesma composição. Tratamos como **gravações
 * distintas**: um novo `Participant Published` sem gravação ativa (ou com a
 * anterior já num estado terminal — READY/FAILED) inicia uma composição NOVA, com um
 * `recordingId` novo. Não tentamos unir os manifestos HLS automaticamente — fica
 * como possível melhoria futura, fora do escopo desta fase.
 *
 * `Participant Unpublished` é um no-op explícito: o auto-shutdown do IVS já cuida de
 * parar a composição sozinho depois de 60s sem publisher; não replicamos essa lógica
 * aqui (evita uma corrida entre nós tentando parar e o IVS fazendo o mesmo).
 */
export class HandleIvsStageUpdateEventUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly recordingRepository: RecordingRepository,
    private readonly ivsRealTimeService: IvsRealTimeServicePort,
    // `LiveSession` não denormaliza `courseId` (só `classId`) — a criação de gravação
    // é rara (uma vez por composição, não por mensagem/participante), então o custo
    // deste GetItem extra é desprezível; não justifica alargar o schema de uma
    // entidade da Fase 5 só para isto.
    private readonly classGroupRepository: ClassGroupRepository,
  ) {}

  async execute(input: HandleIvsStageUpdateEventInput): Promise<void> {
    if (input.eventName === 'Participant Unpublished') {
      return;
    }

    const live = await this.liveSessionRepository.findByStageArn(input.stageArn);
    if (!live) {
      // Evento de um stage que não corresponde a (ou já não corresponde mais a)
      // nenhuma live conhecida — descartado, não é um erro (entrega best-effort).
      return;
    }

    if (live.activeRecordingId) {
      const currentRecording = await this.recordingRepository.findById(live.activeRecordingId);
      const stillActive = currentRecording && !isTerminal(currentRecording);
      if (stillActive) {
        return; // já tem uma composição em andamento para esta live — no-op.
      }
    }

    const classGroup = await this.classGroupRepository.findById(live.classId);
    if (!classGroup) {
      console.error('HandleIvsStageUpdateEvent: ClassGroup not found for live', {
        liveId: live.liveId,
        classId: live.classId,
      });
      return;
    }

    const recordingId = randomUUID();
    const startedAt = new Date().toISOString();

    const createdComposition = await this.ivsRealTimeService.startComposition({
      stageArn: input.stageArn,
      encoderConfigurationArn: input.encoderConfigurationArn,
      storageConfigurationArn: input.storageConfigurationArn,
      idempotencyToken: recordingId,
      tags: { Environment: input.environmentTag },
    });

    const recording: Recording = {
      recordingId,
      liveId: live.liveId,
      courseId: classGroup.courseId,
      institutionId: live.institutionId,
      stageArn: input.stageArn,
      compositionArn: createdComposition.compositionArn,
      ...(createdComposition.s3Prefix !== undefined ? { s3Prefix: createdComposition.s3Prefix } : {}),
      status: 'STARTING',
      startedAt,
      visibility: 'DRAFT',
    };
    await this.recordingRepository.create(recording);

    try {
      await this.liveSessionRepository.claimActiveRecording(
        live.liveId,
        live.activeRecordingId,
        recordingId,
      );
    } catch {
      // Perdemos a corrida contra outra invocação concorrente (dois "Participant
      // Published" quase simultâneos) — mesmo padrão de "ordem de operações" da
      // Fase 5 (reserve→create→attach→revert-never-FAILED): reverte o que já foi
      // feito neste lado, best-effort.
      await this.ivsRealTimeService
        .stopComposition(createdComposition.compositionArn)
        .catch((error: unknown) => {
          console.error('HandleIvsStageUpdateEvent: failed to revert composition after lost race', {
            liveId: live.liveId,
            compositionArn: createdComposition.compositionArn,
            error,
          });
        });
    }
  }
}

function isTerminal(recording: Recording): boolean {
  return recording.status === 'READY' || recording.status === 'FAILED';
}
