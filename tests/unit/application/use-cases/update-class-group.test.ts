import { describe, expect, it } from 'vitest';
import { UpdateClassGroupUseCase } from '@/application/use-cases/update-class-group';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import { buildContext, FakeClassGroupRepository } from './fixtures';

function seedClassGroup(
  repo: FakeClassGroupRepository,
  overrides: Partial<ClassGroup> = {},
): ClassGroup {
  const classGroup: ClassGroup = {
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    name: 'Arquitetura de Software',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(classGroup);
  return classGroup;
}

describe('UpdateClassGroupUseCase — caso crítico da seção 17: professor editando turma de outra turma', () => {
  it('rejects a professor who does not own the class', async () => {
    const repo = new FakeClassGroupRepository();
    seedClassGroup(repo);
    const useCase = new UpdateClassGroupUseCase(repo);

    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-2',
      institutionId: 'institution-1',
    });

    await expect(
      useCase.execute(context, { classId: 'class-1', name: 'Novo nome' }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_OWNED' });
  });

  it('rejects a user from another institution, even if somehow the same userId owns a class elsewhere', async () => {
    const repo = new FakeClassGroupRepository();
    seedClassGroup(repo, { institutionId: 'institution-1', teacherId: 'teacher-1' });
    const useCase = new UpdateClassGroupUseCase(repo);

    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-1',
      institutionId: 'institution-2',
    });

    await expect(
      useCase.execute(context, { classId: 'class-1', name: 'Novo nome' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('allows the professor who owns the class', async () => {
    const repo = new FakeClassGroupRepository();
    seedClassGroup(repo);
    const useCase = new UpdateClassGroupUseCase(repo);

    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-1',
      institutionId: 'institution-1',
    });

    const updated = await useCase.execute(context, { classId: 'class-1', name: 'Novo nome' });
    expect(updated.name).toBe('Novo nome');
  });

  it('always allows ADMIN of the same institution, regardless of ownership', async () => {
    const repo = new FakeClassGroupRepository();
    seedClassGroup(repo);
    const useCase = new UpdateClassGroupUseCase(repo);

    const context = buildContext({
      role: 'ADMIN',
      userId: 'admin-1',
      institutionId: 'institution-1',
    });

    const updated = await useCase.execute(context, { classId: 'class-1', name: 'Novo nome' });
    expect(updated.name).toBe('Novo nome');
  });

  it('rejects an ALUNO trying to edit a class', async () => {
    const repo = new FakeClassGroupRepository();
    seedClassGroup(repo);
    const useCase = new UpdateClassGroupUseCase(repo);

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });

    await expect(
      useCase.execute(context, { classId: 'class-1', name: 'Novo nome' }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_OWNED' });
  });

  it('raises NotFoundError for a class that does not exist', async () => {
    const repo = new FakeClassGroupRepository();
    const useCase = new UpdateClassGroupUseCase(repo);

    const context = buildContext({ role: 'ADMIN' });

    await expect(
      useCase.execute(context, { classId: 'missing-class', name: 'Novo nome' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
