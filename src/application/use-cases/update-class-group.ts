import {
  assertClassOwner,
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
 * Caso crítico da seção 17 do README: "professor tentando editar turma de outra
 * turma" — `assertClassOwner` só deixa passar o dono (ou ADMIN).
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
    assertClassOwner(context, classGroup);

    const updated: ClassGroup = { ...classGroup, name: input.name };
    await this.classGroupRepository.save(updated);
    return updated;
  }
}
