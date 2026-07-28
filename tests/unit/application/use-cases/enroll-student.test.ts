import { describe, expect, it } from 'vitest';
import { EnrollStudentUseCase } from '@/application/use-cases/enroll-student';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import type { Course } from '@/domain/entities/Course';
import {
  buildContext,
  FakeClassGroupRepository,
  FakeCourseRepository,
  FakeEnrollmentRepository,
  FakeUpcomingLiveRepository,
} from './fixtures';

function makeUseCase() {
  const enrollmentRepository = new FakeEnrollmentRepository();
  const classGroupRepository = new FakeClassGroupRepository();
  const courseRepository = new FakeCourseRepository();
  const upcomingLiveRepository = new FakeUpcomingLiveRepository();

  const course: Course = {
    courseId: 'course-1',
    institutionId: 'institution-1',
    name: 'Ciência da Computação',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const classGroup: ClassGroup = {
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    name: 'Arquitetura de Software — Turma A',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  courseRepository.seed(course);
  classGroupRepository.seed(classGroup);

  const useCase = new EnrollStudentUseCase(
    enrollmentRepository,
    classGroupRepository,
    courseRepository,
    upcomingLiveRepository,
  );

  return {
    useCase,
    enrollmentRepository,
    classGroupRepository,
    courseRepository,
    upcomingLiveRepository,
    course,
    classGroup,
  };
}

describe('EnrollStudentUseCase — autorização', () => {
  it('rejects a professor from another institution (seção 17 do README)', async () => {
    const { useCase } = makeUseCase();
    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-1',
      institutionId: 'institution-2',
    });

    await expect(
      useCase.execute(context, { studentId: 'student-1', classId: 'class-1' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rejects a professor who does not own the class', async () => {
    const { useCase } = makeUseCase();
    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-2',
      institutionId: 'institution-1',
    });

    await expect(
      useCase.execute(context, { studentId: 'student-1', classId: 'class-1' }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_OWNED' });
  });

  it('allows the owning professor to enroll a student', async () => {
    const { useCase } = makeUseCase();
    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-1',
      institutionId: 'institution-1',
    });

    const enrollment = await useCase.execute(context, {
      studentId: 'student-1',
      classId: 'class-1',
    });
    expect(enrollment.status).toBe('ACTIVE');
    expect(enrollment.courseName).toBe('Ciência da Computação');
  });
});

describe('EnrollStudentUseCase — manutenção do padrão #5, caminho (c): matrícula depois da live agendada', () => {
  it('backfills UPCOMING# projections for every future live already scheduled in the class', async () => {
    const { useCase, upcomingLiveRepository } = makeUseCase();

    upcomingLiveRepository.seedUpcomingLives('class-1', [
      {
        liveId: 'live-1',
        classId: 'class-1',
        title: 'Aula 1',
        scheduledStartAt: '2026-08-01T14:00:00.000Z',
      },
      {
        liveId: 'live-2',
        classId: 'class-1',
        title: 'Aula 2',
        scheduledStartAt: '2026-08-08T14:00:00.000Z',
      },
    ]);

    const context = buildContext({ role: 'ADMIN' });
    await useCase.execute(context, { studentId: 'student-1', classId: 'class-1' });

    const projections = upcomingLiveRepository.projections.get('student-1') ?? [];
    expect(projections.map((live) => live.liveId).sort()).toEqual(['live-1', 'live-2']);
  });

  it('does not fail or write anything when the class has no upcoming lives yet', async () => {
    const { useCase, upcomingLiveRepository } = makeUseCase();

    const context = buildContext({ role: 'ADMIN' });
    await useCase.execute(context, { studentId: 'student-1', classId: 'class-1' });

    expect(upcomingLiveRepository.projections.get('student-1') ?? []).toEqual([]);
  });

  it('backfilling twice for the same student is idempotent (no duplicate projections)', async () => {
    const { useCase, upcomingLiveRepository, enrollmentRepository } = makeUseCase();

    upcomingLiveRepository.seedUpcomingLives('class-1', [
      {
        liveId: 'live-1',
        classId: 'class-1',
        title: 'Aula 1',
        scheduledStartAt: '2026-08-01T14:00:00.000Z',
      },
    ]);

    const context = buildContext({ role: 'ADMIN' });
    await useCase.execute(context, { studentId: 'student-1', classId: 'class-1' });
    // Reexecuta a matrícula (ex.: retry de um cliente após timeout) — não deve duplicar.
    enrollmentRepository.seed({
      studentId: 'student-1',
      classId: 'class-1',
      courseId: 'course-1',
      institutionId: 'institution-1',
      courseName: 'Ciência da Computação',
      className: 'Arquitetura de Software — Turma A',
      enrolledAt: '2026-01-02T00:00:00.000Z',
      status: 'ACTIVE',
    });
    await useCase.execute(context, { studentId: 'student-1', classId: 'class-1' });

    const projections = upcomingLiveRepository.projections.get('student-1') ?? [];
    expect(projections).toHaveLength(1);
  });
});
