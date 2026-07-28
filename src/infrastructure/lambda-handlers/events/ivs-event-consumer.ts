import 'server-only';
import type { EventBridgeEvent, EventBridgeHandler } from 'aws-lambda';
import { HandleIvsCompositionStateChangeEventUseCase } from '@/application/use-cases/handle-ivs-composition-state-change-event';
import type { CompositionStateChangeEventName } from '@/application/use-cases/handle-ivs-composition-state-change-event';
import { HandleIvsParticipantRecordingStateChangeEventUseCase } from '@/application/use-cases/handle-ivs-participant-recording-state-change-event';
import type { ParticipantRecordingStateChangeEventName } from '@/application/use-cases/handle-ivs-participant-recording-state-change-event';
import { HandleIvsStageUpdateEventUseCase } from '@/application/use-cases/handle-ivs-stage-update-event';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { IvsRealTimeService } from '@/infrastructure/aws/ivs/ivs-real-time-service';
import { DynamoDbClassGroupRepository } from '@/infrastructure/repositories/dynamodb-class-group-repository';
import { DynamoDbLiveSessionRepository } from '@/infrastructure/repositories/dynamodb-live-session-repository';
import { DynamoDbRecordingRepository } from '@/infrastructure/repositories/dynamodb-recording-repository';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não definida.`);
  }
  return value;
}

const tableName = requiredEnv('DYNAMODB_TABLE_NAME');
const encoderConfigurationArn = requiredEnv('IVS_ENCODER_CONFIGURATION_ARN');
const storageConfigurationArn = requiredEnv('IVS_STORAGE_CONFIGURATION_ARN');
const environmentTag = requiredEnv('APP_ENV');
const documentClient = getDocumentClient();

const liveSessionRepository = new DynamoDbLiveSessionRepository(documentClient, tableName);
const recordingRepository = new DynamoDbRecordingRepository(documentClient, tableName);
const classGroupRepository = new DynamoDbClassGroupRepository(documentClient, tableName);
const ivsRealTimeService = new IvsRealTimeService();

const handleStageUpdate = new HandleIvsStageUpdateEventUseCase(
  liveSessionRepository,
  recordingRepository,
  ivsRealTimeService,
  classGroupRepository,
);
const handleCompositionStateChange = new HandleIvsCompositionStateChangeEventUseCase(
  liveSessionRepository,
  recordingRepository,
);
const handleParticipantRecordingStateChange =
  new HandleIvsParticipantRecordingStateChangeEventUseCase(
    liveSessionRepository,
    recordingRepository,
  );

type IvsDetailType =
  | 'IVS Stage Update'
  | 'IVS Composition State Change'
  | 'IVS Participant Recording State Change';

interface IvsEventDetail {
  readonly event_name: string;
  readonly stage_arn?: string;
  readonly error_code?: string;
  readonly reason?: string;
  readonly recording_s3_key_prefix?: string;
  readonly recording_duration_ms?: number;
}

/**
 * Payload documentado em https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/eventbridge.html
 * (docs/fase-1-arquitetura.md, seção 5/11) — o nome do evento fica em
 * `detail.event_name`, nunca no `detail-type`. A extração do ARN do stage muda por
 * `detail-type`: `IVS Stage Update` e `IVS Participant Recording State Change` têm o
 * stage em `resources[0]`; `IVS Composition State Change` tem a COMPOSIÇÃO em
 * `resources[0]` e o stage em `detail.stage_arn`.
 */
export const handler: EventBridgeHandler<IvsDetailType, IvsEventDetail, void> = async (event) => {
  switch (event['detail-type']) {
    case 'IVS Stage Update':
      return handleStageUpdateEvent(event);
    case 'IVS Composition State Change':
      return handleCompositionStateChangeEvent(event);
    case 'IVS Participant Recording State Change':
      return handleParticipantRecordingStateChangeEvent(event);
    default:
      // Regra do EventBridge só casa os três detail-types acima (ver
      // infrastructure/stacks/event-bus-stack.ts) — chegar aqui indicaria uma regra
      // nova criada sem o handler correspondente; melhor falhar alto (vai para a DLQ)
      // do que descartar em silêncio.
      throw new Error(`Unhandled detail-type: ${String(event['detail-type'])}`);
  }
};

async function handleStageUpdateEvent(
  event: EventBridgeEvent<IvsDetailType, IvsEventDetail>,
): Promise<void> {
  const eventName = event.detail.event_name;
  if (eventName !== 'Participant Published' && eventName !== 'Participant Unpublished') {
    return;
  }
  const stageArn = event.resources[0];
  if (!stageArn) return;

  await handleStageUpdate.execute({
    stageArn,
    eventName,
    encoderConfigurationArn,
    storageConfigurationArn,
    environmentTag,
  });
}

async function handleCompositionStateChangeEvent(
  event: EventBridgeEvent<IvsDetailType, IvsEventDetail>,
): Promise<void> {
  const stageArn = event.detail.stage_arn;
  if (!stageArn) return;

  await handleCompositionStateChange.execute({
    stageArn,
    eventName: event.detail.event_name as CompositionStateChangeEventName,
    eventTimeIso: event.time,
    ...(event.detail.reason !== undefined ? { reason: event.detail.reason } : {}),
  });
}

async function handleParticipantRecordingStateChangeEvent(
  event: EventBridgeEvent<IvsDetailType, IvsEventDetail>,
): Promise<void> {
  const stageArn = event.resources[0];
  if (!stageArn) return;

  await handleParticipantRecordingStateChange.execute({
    stageArn,
    eventName: event.detail.event_name as ParticipantRecordingStateChangeEventName,
    eventTimeIso: event.time,
    ...(event.detail.recording_s3_key_prefix !== undefined
      ? { recordingS3KeyPrefix: event.detail.recording_s3_key_prefix }
      : {}),
    ...(event.detail.recording_duration_ms !== undefined
      ? { recordingDurationMs: event.detail.recording_duration_ms }
      : {}),
    ...(event.detail.reason !== undefined ? { reason: event.detail.reason } : {}),
  });
}
