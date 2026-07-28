import { describe, expect, it } from 'vitest';
import { UpdateClassGroupUseCase } from '@/application/use-cases/update-class-group';
import { toErrorResponseBody } from '@/shared/http/toErrorResponseBody';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import { buildContext, FakeClassGroupRepository } from '../use-cases/fixtures';

/**
 * Seção 14 do README: proteção contra enumeração de recursos. Um professor de outra
 * instituição não pode, pela resposta, distinguir "essa turma não existe" de "essa
 * turma existe, mas não é sua instituição" — as duas têm que ser byte-a-byte a mesma
 * resposta HTTP. Este teste é o padrão para todos os casos de uso da Fase 5 em diante.
 */
describe('anti-enumeração institucional', () => {
  it('turma inexistente e turma de outra instituição produzem a mesma resposta HTTP', async () => {
    const classGroup: ClassGroup = {
      classId: 'class-1',
      courseId: 'course-1',
      institutionId: 'institution-1',
      teacherId: 'teacher-1',
      name: 'Arquitetura de Software',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const repoWithClassInAnotherInstitution = new FakeClassGroupRepository();
    repoWithClassInAnotherInstitution.seed(classGroup);
    const useCaseCrossInstitution = new UpdateClassGroupUseCase(repoWithClassInAnotherInstitution);

    const repoWithoutTheClass = new FakeClassGroupRepository();
    const useCaseMissing = new UpdateClassGroupUseCase(repoWithoutTheClass);

    const outsiderContext = buildContext({
      role: 'ADMIN',
      userId: 'outsider-admin',
      institutionId: 'institution-2',
    });

    const crossInstitutionError = await useCaseCrossInstitution
      .execute(outsiderContext, { classId: 'class-1', name: 'Nome tentado' })
      .then(() => {
        throw new Error('expected execute() to reject');
      })
      .catch((error: unknown) => error);

    const missingError = await useCaseMissing
      .execute(outsiderContext, { classId: 'class-1', name: 'Nome tentado' })
      .then(() => {
        throw new Error('expected execute() to reject');
      })
      .catch((error: unknown) => error);

    const requestId = 'req-fixed-for-comparison';
    const crossInstitutionResponse = toErrorResponseBody(crossInstitutionError, requestId);
    const missingResponse = toErrorResponseBody(missingError, requestId);

    expect(JSON.stringify(crossInstitutionResponse)).toBe(JSON.stringify(missingResponse));
    expect(crossInstitutionResponse.status).toBe(404);
    expect(crossInstitutionResponse.body.error.code).toBe('RESOURCE_NOT_FOUND');

    // O motivo real não pode vazar na resposta pública, mas continua disponível para
    // CloudWatch/auditoria via internalMessage (não serializado por toErrorResponseBody).
    expect(JSON.stringify(crossInstitutionResponse)).not.toContain('institution-1');
    expect(JSON.stringify(crossInstitutionResponse)).not.toContain('outsider-admin');
  });
});
