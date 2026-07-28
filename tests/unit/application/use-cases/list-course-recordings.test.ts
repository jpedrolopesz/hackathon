import { describe, expect, it } from 'vitest';
import { ListCourseRecordingsUseCase } from '@/application/use-cases/list-course-recordings';
import type { Course } from '@/domain/entities/Course';
import type { Recording } from '@/domain/entities/Recording';
import { buildContext, FakeCourseRepository } from './fixtures';
import { FakeRecordingRepository } from './recording-fixtures';

function seedCourse(repo: FakeCourseRepository, overrides: Partial<Course> = {}): Course {
  const course: Course = {
    courseId: 'course-1',
    institutionId: 'institution-1',
    name: 'Ciência da Computação',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(course);
  return course;
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
  const courseRepository = new FakeCourseRepository();
  const useCase = new ListCourseRecordingsUseCase(recordingRepository, courseRepository);
  return { useCase, recordingRepository, courseRepository };
}

describe('ListCourseRecordingsUseCase', () => {
  it('rejects a user from another institution with a generic not-found (anti-enumeration)', async () => {
    const { useCase, courseRepository } = makeUseCase();
    seedCourse(courseRepository);

    await expect(
      useCase.execute(buildContext({ institutionId: 'institution-2' }), {
        courseId: 'course-1',
        pageSize: 10,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('lists recordings for the course regardless of visibility (administrative listing)', async () => {
    const { useCase, recordingRepository, courseRepository } = makeUseCase();
    seedCourse(courseRepository);
    seedRecording(recordingRepository, { recordingId: 'recording-1', visibility: 'DRAFT' });
    seedRecording(recordingRepository, { recordingId: 'recording-2', visibility: 'PUBLISHED' });

    const result = await useCase.execute(buildContext(), { courseId: 'course-1', pageSize: 10 });

    expect(result.recordings.map((r) => r.recordingId).sort()).toEqual(['recording-1', 'recording-2']);
  });
});
