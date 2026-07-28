import { describe, expect, it } from 'vitest';
import { HideRecordingUseCase } from '@/application/use-cases/hide-recording';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { Recording } from '@/domain/entities/Recording';
import { buildContext } from './fixtures';
import { FakeLiveSessionRepository } from './live-fixtures';
import { FakeRecordingRepository } from './recording-fixtures';

function seedLive(repo: FakeLiveSessionRepository, overrides: Partial<LiveSession> = {}): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2026-01-01T14:00:00.000Z',
    status: 'ENDED',
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
    stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage',
    status: 'READY',
    startedAt: '2026-01-01T00:00:00.000Z',
    visibility: 'PUBLISHED',
    ...overrides,
  };
  repo.seed(recording);
  return recording;
}

function makeUseCase() {
  const recordingRepository = new FakeRecordingRepository();
  const liveSessionRepository = new FakeLiveSessionRepository();
  const useCase = new HideRecordingUseCase(recordingRepository, liveSessionRepository);
  return { useCase, recordingRepository, liveSessionRepository };
}

describe('HideRecordingUseCase', () => {
  it('rejects a professor who does not own the class', async () => {
    const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);

    await expect(
      useCase.execute(buildContext({ role: 'PROFESSOR', userId: 'teacher-2' }), {
        recordingId: 'recording-1',
      }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_OWNED' });
  });

  it('hides a READY recording (status -> HIDDEN) without touching the S3 object', async () => {
    const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository, { manifestPath: 'course-1/live-1/master.m3u8' });

    const result = await useCase.execute(buildContext({ role: 'ADMIN' }), {
      recordingId: 'recording-1',
    });

    expect(result.status).toBe('HIDDEN');
    expect(result.manifestPath).toBe('course-1/live-1/master.m3u8');
  });
});
