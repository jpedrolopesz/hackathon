import { describe, expect, it } from 'vitest';
import { CreateClassGroupUseCase } from '@/application/use-cases/create-class-group';
import { buildContext, FakeClassGroupRepository, FakeCourseRepository } from './fixtures';

function makeUseCase() {
  const classes = new FakeClassGroupRepository();
  const courses = new FakeCourseRepository();
  courses.seed({
    courseId: 'course-1',
    institutionId: 'institution-1',
    name: 'Curso',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  return new CreateClassGroupUseCase(classes, courses);
}

describe('CreateClassGroupUseCase — gerenciar turma é exclusivo de ADMIN', () => {
  it('allows ADMIN to create a class for an assigned professor', async () => {
    await expect(
      makeUseCase().execute(buildContext({ role: 'ADMIN' }), {
        classId: 'class-1',
        courseId: 'course-1',
        teacherId: 'teacher-1',
        name: 'Turma',
      }),
    ).resolves.toMatchObject({ classId: 'class-1', teacherId: 'teacher-1' });
  });

  for (const role of ['PROFESSOR', 'ALUNO'] as const) {
    it(`rejects ${role}`, async () => {
      await expect(
        makeUseCase().execute(buildContext({ role }), {
          classId: 'class-1',
          courseId: 'course-1',
          teacherId: 'teacher-1',
          name: 'Turma',
        }),
      ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
    });
  }
});
