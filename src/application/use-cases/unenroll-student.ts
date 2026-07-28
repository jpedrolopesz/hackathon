import {
  assertClassOwner,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { ClassGroupRepository } from '@/application/ports/ClassGroupRepository';
import type { EnrollmentRepository } from '@/application/ports/EnrollmentRepository';
import type { UpcomingLiveRepository } from '@/application/ports/UpcomingLiveRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';

export interface UnenrollStudentInput {
  readonly studentId: string;
  readonly classId: string;
}

/**
 * Caminho (d) da manutenção do padrão de acesso #5: sem remover as projeções de lives
 * futuras, o aluno desmatriculado continuaria vendo aulas de uma turma que não
 * frequenta mais.
 */
export class UnenrollStudentUseCase {
  constructor(
    private readonly enrollmentRepository: EnrollmentRepository,
    private readonly classGroupRepository: ClassGroupRepository,
    private readonly upcomingLiveRepository: UpcomingLiveRepository,
  ) {}

  async execute(context: AuthenticatedRequestContext, input: UnenrollStudentInput): Promise<void> {
    const classGroup = await this.classGroupRepository.findById(input.classId);
    if (!classGroup) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `ClassGroup ${input.classId} not found`,
      );
    }

    assertSameInstitution(context, classGroup.institutionId);
    assertClassOwner(context, classGroup);

    const enrollment = await this.enrollmentRepository.find(input.studentId, input.classId);
    if (!enrollment) {
      throw new NotFoundError(
        'Matrícula não encontrada.',
        'NOT_FOUND',
        `Enrollment ${input.studentId}/${input.classId} not found`,
      );
    }

    await this.enrollmentRepository.cancel(input.studentId, input.classId);

    const upcomingLives = await this.upcomingLiveRepository.listUpcomingByClass(classGroup.classId);
    if (upcomingLives.length > 0) {
      await this.upcomingLiveRepository.removeForStudent(
        input.studentId,
        upcomingLives.map((live) => live.liveId),
      );
    }
  }
}
