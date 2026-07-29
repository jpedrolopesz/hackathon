import {
  assertRole,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { ClassGroupRepository } from '@/application/ports/ClassGroupRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { ClassGroup } from '@/domain/entities/ClassGroup';

export interface UpdateClassGroupInput {
  readonly classId: string;
  readonly name: string;
}

/**
 * Gerenciar turmas é permissão de ADMIN (seção 5 do README). Professores editam
 * lives das próprias disciplinas, não a entidade administrativa da turma.
 */
export class UpdateClassGroupUseCase {
  constructor(private readonly classGroupRepository: ClassGroupRepository) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: UpdateClassGroupInput,
  ): Promise<ClassGroup> {
    const classGroup = await this.classGroupRepository.findById(input.classId);
    if (!classGroup) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `ClassGroup ${input.classId} not found`,
      );
    }

    assertSameInstitution(context, classGroup.institutionId);
    assertRole(context, ['ADMIN']);

    const updated: ClassGroup = { ...classGroup, name: input.name };
    await this.classGroupRepository.save(updated);
    return updated;
  }
}
