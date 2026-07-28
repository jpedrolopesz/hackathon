import { describe, expect, it } from 'vitest';
import { PublishRecordingUseCase } from '@/application/use-cases/publish-recording';
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
    visibility: 'DRAFT',
    ...overrides,
  };
  repo.seed(recording);
  return recording;
}

function makeUseCase() {
  const recordingRepository = new FakeRecordingRepository();
  const liveSessionRepository = new FakeLiveSessionRepository();
  const useCase = new PublishRecordingUseCase(recordingRepository, liveSessionRepository);
  return { useCase, recordingRepository, liveSessionRepository };
}

describe('PublishRecordingUseCase', () => {
  it('rejects a user from another institution with a generic not-found (anti-enumeration)', async () => {
    const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);

    await expect(
      useCase.execute(buildContext({ institutionId: 'institution-2' }), {
        recordingId: 'recording-1',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

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

  it('rejects publishing a recording that is not READY', async () => {
    const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository, { status: 'PROCESSING' });

    await expect(
      useCase.execute(buildContext({ role: 'ADMIN' }), { recordingId: 'recording-1' }),
    ).rejects.toThrow();
  });

  it('publishes a READY recording (visibility -> PUBLISHED)', async () => {
    const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);

    const result = await useCase.execute(buildContext({ role: 'ADMIN' }), {
      recordingId: 'recording-1',
    });

    expect(result.visibility).toBe('PUBLISHED');
  });
});
