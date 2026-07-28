import { describe, expect, it } from 'vitest';
import { GetRecordingPlaybackUseCase } from '@/application/use-cases/get-recording-playback';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { Recording } from '@/domain/entities/Recording';
import type { Enrollment } from '@/domain/entities/Enrollment';
import { buildContext, FakeEnrollmentRepository } from './fixtures';
import { FakeLiveSessionRepository } from './live-fixtures';
import { FakeCloudFrontSigningService, FakeRecordingRepository } from './recording-fixtures';

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
    cloudFrontPath: 'course-1/live-1/master.m3u8',
    ...overrides,
  };
  repo.seed(recording);
  return recording;
}

function seedActiveEnrollment(repo: FakeEnrollmentRepository): Enrollment {
  const enrollment: Enrollment = {
    studentId: 'student-1',
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    courseName: 'Ciência da Computação',
    className: 'Aula 1',
    enrolledAt: '2026-01-01T00:00:00.000Z',
    status: 'ACTIVE',
  };
  repo.seed(enrollment);
  return enrollment;
}

function makeUseCase() {
  const recordingRepository = new FakeRecordingRepository();
  const liveSessionRepository = new FakeLiveSessionRepository();
  const enrollmentRepository = new FakeEnrollmentRepository();
  const cloudFrontSigningService = new FakeCloudFrontSigningService();
  const useCase = new GetRecordingPlaybackUseCase(
    recordingRepository,
    liveSessionRepository,
    enrollmentRepository,
    cloudFrontSigningService,
    'media.example.com',
  );
  return {
    useCase,
    recordingRepository,
    liveSessionRepository,
    enrollmentRepository,
    cloudFrontSigningService,
  };
}

describe('GetRecordingPlaybackUseCase', () => {
  it('rejects a student who is not enrolled in the class (anti-enumeration)', async () => {
    const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);

    await expect(
      useCase.execute(buildContext({ role: 'ALUNO', userId: 'student-1' }), {
        recordingId: 'recording-1',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rejects a recording that is not READY/PUBLISHED yet', async () => {
    const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository, { status: 'PROCESSING', visibility: 'DRAFT' });

    await expect(
      useCase.execute(buildContext({ role: 'ADMIN' }), { recordingId: 'recording-1' }),
    ).rejects.toMatchObject({ code: 'RECORDING_NOT_AVAILABLE' });
  });

  it('rejects a READY recording that the professor has not published yet', async () => {
    const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository, { visibility: 'DRAFT' });

    await expect(
      useCase.execute(buildContext({ role: 'ADMIN' }), { recordingId: 'recording-1' }),
    ).rejects.toMatchObject({ code: 'RECORDING_NOT_AVAILABLE' });
  });

  it('signs a playback URL for an enrolled student when the recording is READY/PUBLISHED', async () => {
    const { useCase, recordingRepository, liveSessionRepository, enrollmentRepository, cloudFrontSigningService } =
      makeUseCase();
    seedLive(liveSessionRepository);
    seedRecording(recordingRepository);
    seedActiveEnrollment(enrollmentRepository);

    const result = await useCase.execute(
      buildContext({ role: 'ALUNO', userId: 'student-1', institutionId: 'institution-1' }),
      { recordingId: 'recording-1' },
    );

    expect(result.playbackUrl).toContain('media.example.com/course-1/live-1/master.m3u8');
    expect(cloudFrontSigningService.calls).toHaveLength(1);
  });
});
