import { describe, expect, it } from 'vitest';
import { ListUpcomingLivesForTeacherUseCase } from '@/application/use-cases/list-upcoming-lives-for-teacher';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { buildContext, FakeClassGroupRepository } from './fixtures';
import { FakeLiveSessionRepository } from './live-fixtures';

function seedClass(repo: FakeClassGroupRepository, overrides: Partial<ClassGroup> = {}): ClassGroup {
  const classGroup: ClassGroup = {
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    name: 'Turma A',
    createdAt: '2025-12-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(classGroup);
  return classGroup;
}

function seedLive(repo: FakeLiveSessionRepository, overrides: Partial<LiveSession> = {}): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula',
    scheduledStartAt: '2026-01-01T14:00:00.000Z',
    status: 'SCHEDULED',
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(live);
  return live;
}

describe('ListUpcomingLivesForTeacherUseCase', () => {
  it('rejects a student trying to list "their" lives as a teacher', async () => {
    const classRepo = new FakeClassGroupRepository();
    const liveRepo = new FakeLiveSessionRepository();
    const useCase = new ListUpcomingLivesForTeacherUseCase(classRepo, liveRepo);

    await expect(
      useCase.execute(buildContext({ role: 'ALUNO', userId: 'student-1' })),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
  });

  it('lists only lives from classes owned by the teacher, sorted by scheduledStartAt', async () => {
    const classRepo = new FakeClassGroupRepository();
    const liveRepo = new FakeLiveSessionRepository();
    seedClass(classRepo, { classId: 'class-1', teacherId: 'teacher-1' });
    seedClass(classRepo, { classId: 'class-2', teacherId: 'teacher-2' });

    seedLive(liveRepo, {
      liveId: 'live-later',
      classId: 'class-1',
      scheduledStartAt: '2026-02-01T00:00:00.000Z',
    });
    seedLive(liveRepo, {
      liveId: 'live-earlier',
      classId: 'class-1',
      scheduledStartAt: '2026-01-01T00:00:00.000Z',
    });
    seedLive(liveRepo, {
      liveId: 'live-other-teacher',
      classId: 'class-2',
      teacherId: 'teacher-2',
      scheduledStartAt: '2026-01-01T00:00:00.000Z',
    });

    const useCase = new ListUpcomingLivesForTeacherUseCase(classRepo, liveRepo);
    const result = await useCase.execute(buildContext({ role: 'PROFESSOR', userId: 'teacher-1' }));

    expect(result.map((live) => live.liveId)).toEqual(['live-earlier', 'live-later']);
  });

  it('excludes lives that already ended or were canceled', async () => {
    const classRepo = new FakeClassGroupRepository();
    const liveRepo = new FakeLiveSessionRepository();
    seedClass(classRepo);
    seedLive(liveRepo, { liveId: 'live-ended', status: 'ENDED' });
    seedLive(liveRepo, { liveId: 'live-canceled', status: 'CANCELED' });
    seedLive(liveRepo, { liveId: 'live-scheduled', status: 'SCHEDULED' });

    const useCase = new ListUpcomingLivesForTeacherUseCase(classRepo, liveRepo);
    const result = await useCase.execute(buildContext({ role: 'PROFESSOR', userId: 'teacher-1' }));

    expect(result.map((live) => live.liveId)).toEqual(['live-scheduled']);
  });
});
