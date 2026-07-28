import {
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { ConnectionTicketRepository } from '@/application/ports/ConnectionTicketRepository';
import type { LiveParticipantRepository } from '@/application/ports/LiveParticipantRepository';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { issueConnectionTicket } from '@/application/realtime/issue-connection-ticket';
import type { IssuedConnectionTicket } from '@/application/realtime/issue-connection-ticket';
import { ConflictError } from '@/domain/errors/ConflictError';
import { NotFoundError } from '@/domain/errors/NotFoundError';

export interface IssueConnectionTicketInput {
  readonly liveId: string;
}

/**
 * Endpoint enxuto (`POST /lives/{liveId}/realtime/ticket`, docs/fase-1-arquitetura.md
 * seção 10.9) para reconexão do WebSocket — deliberadamente separado de
 * `JoinLiveUseCase`. A desconexão do WebSocket (idle timeout de 10min, teto de 2h) é
 * um evento de TRANSPORTE, independente da sessão IVS — reconectar não deveria custar
 * um `CreateParticipantToken` (50 TPS, cota de conta). Este use-case não chama a API
 * do IVS nem grava `LiveParticipant`: só confirma que a pessoa já entrou de verdade
 * (via `join`) e emite um ticket novo.
 */
export class IssueConnectionTicketUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly liveParticipantRepository: LiveParticipantRepository,
    private readonly connectionTicketRepository: ConnectionTicketRepository,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: IssueConnectionTicketInput,
  ): Promise<IssuedConnectionTicket> {
    const live = await this.liveSessionRepository.findById(input.liveId);
    if (!live) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${input.liveId} not found`,
      );
    }

    assertSameInstitution(context, live.institutionId);

    const participant = await this.liveParticipantRepository.findByUser(
      input.liveId,
      context.userId,
    );
    if (!participant) {
      throw new ConflictError(
        'Você ainda não entrou nesta aula.',
        'NOT_JOINED',
        `User ${context.userId} has no LiveParticipant in live ${input.liveId}`,
      );
    }

    return issueConnectionTicket(this.connectionTicketRepository, input.liveId, context.userId);
  }
}
