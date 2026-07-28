import {
  assertClassOwner,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { ClassGroupRepository } from '@/application/ports/ClassGroupRepository';
import type { CourseRepository } from '@/application/ports/CourseRepository';
import type { EnrollmentRepository } from '@/application/ports/EnrollmentRepository';
import type { UpcomingLiveRepository } from '@/application/ports/UpcomingLiveRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { Enrollment } from '@/domain/entities/Enrollment';

export interface EnrollStudentInput {
  readonly studentId: string;
  readonly classId: string;
}

/**
 * Quem matricula é ADMIN ou o professor dono da turma (`assertClassOwner`) —
 * matricular em turma de outra instituição ou de outro professor nunca passa daqui.
 *
 * Caminho (c) da manutenção do padrão de acesso #5 (docs/fase-1-arquitetura.md, seção
 * 6): se a turma já tem lives futuras agendadas, esta matrícula precisa de backfill —
 * sem isso, o aluno não veria aulas que já existiam antes dele se matricular.
 */
export class EnrollStudentUseCase {
  constructor(
    private readonly enrollmentRepository: EnrollmentRepository,
    private readonly classGroupRepository: ClassGroupRepository,
    private readonly courseRepository: CourseRepository,
    private readonly upcomingLiveRepository: UpcomingLiveRepository,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: EnrollStudentInput,
  ): Promise<Enrollment> {
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

    const course = await this.courseRepository.findById(classGroup.courseId);
    if (!course) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `Course ${classGroup.courseId} not found`,
      );
    }

    const enrollment: Enrollment = {
      studentId: input.studentId,
      classId: classGroup.classId,
      courseId: classGroup.courseId,
      institutionId: classGroup.institutionId,
      courseName: course.name,
      className: classGroup.name,
      enrolledAt: new Date().toISOString(),
      status: 'ACTIVE',
    };

    await this.enrollmentRepository.save(enrollment);

    const upcomingLives = await this.upcomingLiveRepository.listUpcomingByClass(classGroup.classId);
    if (upcomingLives.length > 0) {
      await this.upcomingLiveRepository.projectForStudent(input.studentId, upcomingLives);
    }

    return enrollment;
  }
}
