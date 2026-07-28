import { describe, expect, it } from 'vitest';
import { UnenrollStudentUseCase } from '@/application/use-cases/unenroll-student';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import type { Enrollment } from '@/domain/entities/Enrollment';
import {
  buildContext,
  FakeClassGroupRepository,
  FakeEnrollmentRepository,
  FakeUpcomingLiveRepository,
} from './fixtures';

function makeUseCase() {
  const enrollmentRepository = new FakeEnrollmentRepository();
  const classGroupRepository = new FakeClassGroupRepository();
  const upcomingLiveRepository = new FakeUpcomingLiveRepository();

  const classGroup: ClassGroup = {
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    name: 'Arquitetura de Software — Turma A',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  classGroupRepository.seed(classGroup);

  const enrollment: Enrollment = {
    studentId: 'student-1',
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    courseName: 'Ciência da Computação',
    className: classGroup.name,
    enrolledAt: '2026-01-02T00:00:00.000Z',
    status: 'ACTIVE',
  };
  enrollmentRepository.seed(enrollment);

  const useCase = new UnenrollStudentUseCase(
    enrollmentRepository,
    classGroupRepository,
    upcomingLiveRepository,
  );

  return {
    useCase,
    enrollmentRepository,
    classGroupRepository,
    upcomingLiveRepository,
    classGroup,
  };
}

describe('UnenrollStudentUseCase — manutenção do padrão #5, caminho (d): matrícula cancelada', () => {
  it('removes UPCOMING# projections of future lives for the unenrolled student', async () => {
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
    await upcomingLiveRepository.projectForStudent('student-1', [
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

    expect(upcomingLiveRepository.projections.get('student-1')).toEqual([]);
  });

  it('marks the enrollment as CANCELED', async () => {
    const { useCase, enrollmentRepository } = makeUseCase();

    const context = buildContext({ role: 'ADMIN' });
    await useCase.execute(context, { studentId: 'student-1', classId: 'class-1' });

    const enrollment = await enrollmentRepository.find('student-1', 'class-1');
    expect(enrollment?.status).toBe('CANCELED');
  });

  it('rejects a professor from another institution', async () => {
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

  it('raises NotFoundError when the enrollment does not exist', async () => {
    const { useCase } = makeUseCase();
    const context = buildContext({ role: 'ADMIN' });

    await expect(
      useCase.execute(context, { studentId: 'student-2', classId: 'class-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
