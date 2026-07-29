import {
  assertRole,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { ClassGroupRepository } from '@/application/ports/ClassGroupRepository';
import type { CourseRepository } from '@/application/ports/CourseRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import { ValidationError } from '@/domain/errors/ValidationError';
import type { ClassGroup } from '@/domain/entities/ClassGroup';

export interface CreateClassGroupInput {
  readonly classId: string;
  readonly courseId: string;
  readonly name: string;
  /** Professor responsável pela turma; somente ADMIN cria turmas. */
  readonly teacherId?: string;
}

export class CreateClassGroupUseCase {
  constructor(
    private readonly classGroupRepository: ClassGroupRepository,
    private readonly courseRepository: CourseRepository,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: CreateClassGroupInput,
  ): Promise<ClassGroup> {
    assertRole(context, ['ADMIN']);

    const course = await this.courseRepository.findById(input.courseId);
    if (!course) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `Course ${input.courseId} not found`,
      );
    }
    assertSameInstitution(context, course.institutionId);

    const teacherId = input.teacherId;
    if (!teacherId) {
      throw new ValidationError(
        'É necessário informar o professor responsável pela turma.',
        'VALIDATION_ERROR',
        [{ path: 'teacherId', message: 'obrigatório' }],
      );
    }

    const classGroup: ClassGroup = {
      classId: input.classId,
      courseId: input.courseId,
      institutionId: course.institutionId,
      teacherId,
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    await this.classGroupRepository.save(classGroup);
    return classGroup;
  }
}
