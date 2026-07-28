import { describe, expect, it } from 'vitest';
import { HandleIvsParticipantRecordingStateChangeEventUseCase } from '@/application/use-cases/handle-ivs-participant-recording-state-change-event';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { Recording } from '@/domain/entities/Recording';
import { FakeLiveSessionRepository } from './live-fixtures';
import { FakeRecordingRepository } from './recording-fixtures';

const STAGE_ARN = 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage';

function seedLive(repo: FakeLiveSessionRepository, overrides: Partial<LiveSession> = {}): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2026-01-01T14:00:00.000Z',
    status: 'LIVE',
    stageArn: STAGE_ARN,
    activeRecordingId: 'recording-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
    status: 'PROCESSING',
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
  const useCase = new HandleIvsParticipantRecordingStateChangeEventUseCase(
    liveSessionRepository,
    recordingRepository,
  );
  return { useCase, liveSessionRepository, recordingRepository };
}

describe('HandleIvsParticipantRecordingStateChangeEventUseCase', () => {
  it('Recording Start is an explicit no-op', async () => {
    const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);

    await useCase.execute({
      stageArn: STAGE_ARN,
      eventName: 'Recording Start',
      eventTimeIso: '2026-01-01T00:01:00.000Z',
    });

    expect(recordingRepository.get('recording-1')?.status).toBe('PROCESSING');
  });

  it('Recording End transitions to READY with manifestPath/durationSeconds and clears activeRecordingId', async () => {
    const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);

    await useCase.execute({
      stageArn: STAGE_ARN,
      eventName: 'Recording End',
      eventTimeIso: '2026-01-01T00:10:00.000Z',
      recordingS3KeyPrefix: 'stage-1/session-1/composition',
      recordingDurationMs: 547_327,
    });

    const recording = recordingRepository.get('recording-1');
    expect(recording?.status).toBe('READY');
    expect(recording?.manifestPath).toBe('stage-1/session-1/composition/master.m3u8');
    expect(recording?.cloudFrontPath).toBe(recording?.manifestPath);
    expect(recording?.durationSeconds).toBe(547); // arredondado de ms para s

    expect(liveSessionRepository.get('live-1')?.activeRecordingId).toBeUndefined();
  });

  it('Recording End Failure transitions to FAILED and also clears activeRecordingId', async () => {
    const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);

    await useCase.execute({
      stageArn: STAGE_ARN,
      eventName: 'Recording End Failure',
      eventTimeIso: '2026-01-01T00:10:00.000Z',
      reason: 'Access denied to S3 bucket',
    });

    expect(recordingRepository.get('recording-1')?.status).toBe('FAILED');
    expect(liveSessionRepository.get('live-1')?.activeRecordingId).toBeUndefined();
  });

  it('a duplicate Recording End, delivered again after a brand-new recording has already claimed activeRecordingId, does not clear the new recording\'s association', async () => {
    const { useCase, liveSessionRepository, recordingRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);

    await useCase.execute({
      stageArn: STAGE_ARN,
      eventName: 'Recording End',
      eventTimeIso: '2026-01-01T00:10:00.000Z',
      recordingS3KeyPrefix: 'stage-1/session-1/composition',
      recordingDurationMs: 500_000,
    });
    // Uma segunda gravação já começou nesta live nesse meio tempo (professor
    // reconectou após o auto-shutdown) — o duplicado não pode mexer nela.
    await liveSessionRepository.claimActiveRecording('live-1', undefined, 'recording-2');
    seedRecording(recordingRepository, { recordingId: 'recording-2', status: 'STARTING' });

    await useCase.execute({
      stageArn: STAGE_ARN,
      eventName: 'Recording End',
      eventTimeIso: '2026-01-01T00:10:00.000Z',
      recordingS3KeyPrefix: 'stage-1/session-1/composition',
      recordingDurationMs: 500_000,
    });

    // recording-2 está em STARTING, fora de `statusesThatCanTransitionTo('READY')`
    // (só PROCESSING transita para READY) — a guarda da máquina de estados por si só
    // já rejeita o duplicado, mesmo endereçando o recordingId errado.
    expect(recordingRepository.get('recording-2')?.status).toBe('STARTING');
    expect(liveSessionRepository.get('live-1')?.activeRecordingId).toBe('recording-2');
  });
});
