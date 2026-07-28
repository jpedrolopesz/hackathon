import { describe, expect, it } from 'vitest';
import { ScheduleLiveUseCase } from '@/application/use-cases/schedule-live';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import { buildContext, FakeClassGroupRepository } from './fixtures';
import { FakeLiveSessionRepository } from './live-fixtures';

function seedClassGroup(repo: FakeClassGroupRepository): ClassGroup {
  const classGroup: ClassGroup = {
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    name: 'Arquitetura de Software',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  repo.seed(classGroup);
  return classGroup;
}

describe('ScheduleLiveUseCase', () => {
  it('creates a live in SCHEDULED status, denormalizing teacherId from the class', async () => {
    const classGroupRepository = new FakeClassGroupRepository();
    seedClassGroup(classGroupRepository);
    const liveSessionRepository = new FakeLiveSessionRepository();
    const useCase = new ScheduleLiveUseCase(liveSessionRepository, classGroupRepository);

    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-1',
      institutionId: 'institution-1',
    });
    const live = await useCase.execute(context, {
      liveId: 'live-1',
      classId: 'class-1',
      title: 'Aula 1',
      scheduledStartAt: '2099-01-01T14:00:00.000Z',
    });

    expect(live.status).toBe('SCHEDULED');
    expect(live.teacherId).toBe('teacher-1');
    expect(live.stageArn).toBeUndefined();
  });

  it('rejects a professor who does not own the class', async () => {
    const classGroupRepository = new FakeClassGroupRepository();
    seedClassGroup(classGroupRepository);
    const useCase = new ScheduleLiveUseCase(new FakeLiveSessionRepository(), classGroupRepository);

    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-2',
      institutionId: 'institution-1',
    });

    await expect(
      useCase.execute(context, {
        liveId: 'live-1',
        classId: 'class-1',
        title: 'Aula 1',
        scheduledStartAt: '2099-01-01T14:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_OWNED' });
  });

  it('rejects a user from another institution with the generic not-found', async () => {
    const classGroupRepository = new FakeClassGroupRepository();
    seedClassGroup(classGroupRepository);
    const useCase = new ScheduleLiveUseCase(new FakeLiveSessionRepository(), classGroupRepository);

    const context = buildContext({ role: 'ADMIN', institutionId: 'institution-2' });

    await expect(
      useCase.execute(context, {
        liveId: 'live-1',
        classId: 'class-1',
        title: 'Aula 1',
        scheduledStartAt: '2099-01-01T14:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
