import {
  assertClassOwner,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import { ValidationError } from '@/domain/errors/ValidationError';
import type { LiveSession } from '@/domain/entities/LiveSession';

export interface UpdateLiveInput {
  readonly liveId: string;
  readonly title: string;
  readonly description?: string;
  readonly scheduledStartAt: string;
  readonly scheduledDurationMinutes?: number;
}

/**
 * Seção 13 do README: "editar título, descrição, disciplina e horário". "Disciplina"
 * não é editável aqui — é a `ClassGroup`/`Course` à qual a live já pertence
 * (`classId` é imutável após a criação; trocar de turma mudaria dono, instituição e
 * matrícula de aluno, um escopo bem maior que "editar os detalhes da aula"). Só
 * título, descrição e horário mudam.
 *
 * Só permite editar em `DRAFT`/`SCHEDULED` — depois que o Stage é provisionado
 * (`WAITING` em diante), a aula já está em andamento/prestes a começar; mudar
 * título/horário nesse ponto seria confuso para quem já entrou na sala de espera.
 */
export class UpdateLiveUseCase {
  constructor(private readonly liveSessionRepository: LiveSessionRepository) {}

  async execute(context: AuthenticatedRequestContext, input: UpdateLiveInput): Promise<LiveSession> {
    if (
      input.scheduledDurationMinutes !== undefined &&
      (!Number.isInteger(input.scheduledDurationMinutes) ||
        input.scheduledDurationMinutes < 15 ||
        input.scheduledDurationMinutes > 20_130)
    ) {
      throw new ValidationError(
        'A duração agendada deve ficar entre 15 e 20130 minutos.',
        'LIVE_DURATION_INVALID',
      );
    }
    const live = await this.liveSessionRepository.findById(input.liveId);
    if (!live) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${input.liveId} not found`,
      );
    }

    assertSameInstitution(context, live.institutionId);
    assertClassOwner(context, live);

    if (live.status !== 'DRAFT' && live.status !== 'SCHEDULED') {
      throw new ConflictError(
        'Esta aula já está em andamento ou foi encerrada e não pode mais ser editada.',
        'INVALID_STATE_TRANSITION',
        `LiveSession ${input.liveId} cannot be edited from status ${live.status}`,
      );
    }

    await this.liveSessionRepository.updateDetails(input.liveId, {
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      scheduledStartAt: input.scheduledStartAt,
      ...(input.scheduledDurationMinutes !== undefined
        ? { scheduledDurationMinutes: input.scheduledDurationMinutes }
        : {}),
    });

    const updated = await this.liveSessionRepository.findById(input.liveId);
    if (!updated) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${input.liveId} not found after update`,
      );
    }
    return updated;
  }
}
