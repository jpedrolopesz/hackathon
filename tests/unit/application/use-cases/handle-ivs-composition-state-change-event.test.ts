import { describe, expect, it } from 'vitest';
import { HandleIvsCompositionStateChangeEventUseCase } from '@/application/use-cases/handle-ivs-composition-state-change-event';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { Recording } from '@/domain/entities/Recording';
import { FakeLiveSessionRepository } from './live-fixtures';
import { FakeRecordingRepository } from './recording-fixtures';

const STAGE_ARN = 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage';

function seedLive(
  repo: FakeLiveSessionRepository,
  overrides: Partial<LiveSession> = {},
  activeRecordingId: string | undefined = 'recording-1',
): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2026-01-01T14:00:00.000Z',
    status: 'LIVE',
    stageArn: STAGE_ARN,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(activeRecordingId !== undefined ? { activeRecordingId } : {}),
    ...overrides,
  };
  repo.seed(live);
  return live;
}

function seedRecording(repo: FakeRecordingRepository, overrides: Partial<Recording> = {}): Recording {
  const recording: Recording = {
    recordingId: 'recording-1',
    liveId: 'live-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    stageArn: STAGE_ARN,
    status: 'STARTING',
    startedAt: '2026-01-01T00:00:00.000Z',
    visibility: 'DRAFT',
    ...overrides,
  };
  repo.seed(recording);
  return recording;
}

function makeUseCase() {
  const liveSessionRepository = new FakeLiveSessionRepository();
  const recordingRepository = new FakeRecordingRepository();
  const useCase = new HandleIvsCompositionStateChangeEventUseCase(
    liveSessionRepository,
    recordingRepository,
  );
  return { useCase, liveSessionRepository, recordingRepository };
}

describe('HandleIvsCompositionStateChangeEventUseCase', () => {
  it('Session Start transitions STARTING -> RECORDING', async () => {
    const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);

    await useCase.execute({
      stageArn: STAGE_ARN,
      eventName: 'Session Start',
      eventTimeIso: '2026-01-01T00:01:00.000Z',
    });

    expect(recordingRepository.get('recording-1')?.status).toBe('RECORDING');
  });

  it('Session End transitions RECORDING -> PROCESSING with endedAt', async () => {
    const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository, { status: 'RECORDING' });

    await useCase.execute({
      stageArn: STAGE_ARN,
      eventName: 'Session End',
      eventTimeIso: '2026-01-01T00:05:00.000Z',
    });

    const recording = recordingRepository.get('recording-1');
    expect(recording?.status).toBe('PROCESSING');
    expect(recording?.endedAt).toBe('2026-01-01T00:05:00.000Z');
  });

  it('Session Failure transitions to FAILED with the reason as errorMessage', async () => {
    const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository, { status: 'RECORDING' });

    await useCase.execute({
      stageArn: STAGE_ARN,
      eventName: 'Session Failure',
      eventTimeIso: '2026-01-01T00:05:00.000Z',
      reason: 'One or more outputs failed',
    });

    const recording = recordingRepository.get('recording-1');
    expect(recording?.status).toBe('FAILED');
    expect(recording?.errorMessage).toBe('One or more outputs failed');
  });

  it('Destination Start/End/Reconnecting are explicit no-ops', async () => {
    const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository, { status: 'RECORDING' });

    for (const eventName of ['Destination Start', 'Destination End', 'Destination Reconnecting'] as const) {
      await useCase.execute({ stageArn: STAGE_ARN, eventName, eventTimeIso: '2026-01-01T00:05:00.000Z' });
    }

    expect(recordingRepository.get('recording-1')?.status).toBe('RECORDING');
  });

  it('a stage with no active recording is discarded, not an error', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository, {}, undefined);

    await expect(
      useCase.execute({ stageArn: STAGE_ARN, eventName: 'Session Start', eventTimeIso: '2026-01-01T00:01:00.000Z' }),
    ).resolves.toBeUndefined();
  });

  describe('duplicate and out-of-order events (seção 17 do README)', () => {
    it('a duplicate Session End (same event_time reapplied) is discarded, not reprocessed', async () => {
      const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { status: 'RECORDING' });

      await useCase.execute({
        stageArn: STAGE_ARN,
        eventName: 'Session End',
        eventTimeIso: '2026-01-01T00:05:00.000Z',
      });
      // A mesma notificação chega de novo (entrega at-least-once do EventBridge).
      await useCase.execute({
        stageArn: STAGE_ARN,
        eventName: 'Session End',
        eventTimeIso: '2026-01-01T00:05:00.000Z',
      });

      const recording = recordingRepository.get('recording-1');
      expect(recording?.status).toBe('PROCESSING');
      expect(recording?.lastEventTime).toBe('2026-01-01T00:05:00.000Z');
    });

    it('an out-of-order Session Start arriving AFTER Session End was already applied does not regress the status', async () => {
      const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { status: 'RECORDING' });

      // Session End (mais recente) processado primeiro.
      await useCase.execute({
        stageArn: STAGE_ARN,
        eventName: 'Session End',
        eventTimeIso: '2026-01-01T00:05:00.000Z',
      });
      // Session Start (mais antigo) chega depois, atrasado.
      await useCase.execute({
        stageArn: STAGE_ARN,
        eventName: 'Session Start',
        eventTimeIso: '2026-01-01T00:01:00.000Z',
      });

      // PROCESSING não regride para RECORDING.
      expect(recordingRepository.get('recording-1')?.status).toBe('PROCESSING');
    });

    it('an out-of-order Session Failure with an OLDER event_time than the applied Session End is discarded', async () => {
      const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { status: 'RECORDING' });

      await useCase.execute({
        stageArn: STAGE_ARN,
        eventName: 'Session End',
        eventTimeIso: '2026-01-01T00:05:00.000Z',
      });
      await useCase.execute({
        stageArn: STAGE_ARN,
        eventName: 'Session Failure',
        eventTimeIso: '2026-01-01T00:02:00.000Z',
        reason: 'stale failure',
      });

      const recording = recordingRepository.get('recording-1');
      expect(recording?.status).toBe('PROCESSING');
      expect(recording?.errorMessage).toBeUndefined();
    });
  });
});
