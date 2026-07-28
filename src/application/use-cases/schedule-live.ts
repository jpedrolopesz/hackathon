import {
  assertClassOwner,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { ClassGroupRepository } from '@/application/ports/ClassGroupRepository';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { LiveSession } from '@/domain/entities/LiveSession';

export interface ScheduleLiveInput {
  readonly liveId: string;
  readonly classId: string;
  readonly title: string;
  readonly description?: string;
  readonly scheduledStartAt: string;
}

/**
 * Seção 10 do README: só professor autorizado cria live, e ela precisa estar
 * associada a uma turma. Cria diretamente em `SCHEDULED` (não passa por `DRAFT` — não
 * há necessidade de um rascunho intermediário neste fluxo mínimo).
 */
export class ScheduleLiveUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly classGroupRepository: ClassGroupRepository,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: ScheduleLiveInput,
  ): Promise<LiveSession> {
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

    const now = new Date().toISOString();
    const live: LiveSession = {
      liveId: input.liveId,
      classId: classGroup.classId,
      institutionId: classGroup.institutionId,
      teacherId: classGroup.teacherId,
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      scheduledStartAt: input.scheduledStartAt,
      status: 'SCHEDULED',
      createdAt: now,
      updatedAt: now,
    };

    await this.liveSessionRepository.create(live);
    return live;
  }
}
