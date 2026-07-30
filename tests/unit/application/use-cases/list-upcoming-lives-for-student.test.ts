import { describe, expect, it } from 'vitest';
import { ListUpcomingLivesForStudentUseCase } from '@/application/use-cases/list-upcoming-lives-for-student';
import { FakeEnrollmentRepository, buildContext } from './fixtures';
import { FakeLiveSessionRepository } from './live-fixtures';
import type { Enrollment } from '@/domain/entities/Enrollment';
import type { LiveSession } from '@/domain/entities/LiveSession';

const enrollment: Enrollment = {
  studentId: 'student-1',
  classId: 'class-1',
  courseId: 'course-1',
  institutionId: 'institution-1',
  courseName: 'Curso',
  className: 'Turma',
  enrolledAt: '2026-01-01T00:00:00.000Z',
  status: 'ACTIVE',
};

function live(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula',
    scheduledStartAt: '2026-01-02T00:00:00.000Z',
    status: 'SCHEDULED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ListUpcomingLivesForStudentUseCase', () => {
  it('lista somente aulas visíveis de matrículas ativas do próprio aluno', async () => {
    const enrollments = new FakeEnrollmentRepository();
    const lives = new FakeLiveSessionRepository();
    enrollments.seed(enrollment);
    enrollments.seed({ ...enrollment, classId: 'class-canceled', status: 'CANCELED' });
    lives.seed(live());
    lives.seed(live({ liveId: 'ended', status: 'ENDED' }));
    lives.seed(live({ liveId: 'canceled-class', classId: 'class-canceled' }));

    const result = await new ListUpcomingLivesForStudentUseCase(enrollments, lives).execute(
      buildContext({ role: 'ALUNO', userId: 'student-1' }),
    );

    expect(result.map((item) => item.liveId)).toEqual(['live-1']);
  });

  it('rejeita papéis que não sejam ALUNO', async () => {
    const useCase = new ListUpcomingLivesForStudentUseCase(
      new FakeEnrollmentRepository(),
      new FakeLiveSessionRepository(),
    );
    await expect(useCase.execute(buildContext({ role: 'PROFESSOR' }))).rejects.toMatchObject({
      code: 'ROLE_NOT_ALLOWED',
    });
  });
});
