import {
  assertClassOwner,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { IvsRealTimeServicePort } from '@/application/ports/IvsRealTimeServicePort';
import type { LiveParticipantRepository } from '@/application/ports/LiveParticipantRepository';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { LiveParticipant } from '@/domain/entities/LiveParticipant';
import { IVS_TOKEN_CAPABILITIES_BY_ROLE } from '@/infrastructure/aws/ivs/participant-token-attributes';

export interface DemoteParticipantInput {
  readonly liveId: string;
  readonly targetLiveParticipantId: string;
}

/**
 * SEGURANÇA (docs/fase-1-arquitetura.md, seção 4): rebaixar por reemissão de token,
 * sozinho, é incompleto por construção — o token PUBLISH antigo continua válido até
 * expirar (não existe `RevokeParticipantToken` na API, verificado). Token Exchange do
 * IVS não é uma alternativa aqui: só funciona com tokens autoassinados via key pair,
 * não com os do `CreateParticipantToken` que usamos.
 *
 * Por isso o rebaixamento chama `DisconnectParticipant` (também 5 TPS, fixo) para
 * derrubar a sessão ativa AGORA — é a única forma de garantir que o token PUBLISH
 * antigo pare de valer imediatamente. Não reemite um token novo aqui: o cliente
 * reconecta chamando `join` de novo (Fase 6 entrega isso via WebSocket
 * `participant.demoted`), que já resolve o `LiveParticipant` existente e emite um
 * token SUBSCRIBE-only.
 */
export class DemoteParticipantUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly liveParticipantRepository: LiveParticipantRepository,
    private readonly ivsRealTimeService: IvsRealTimeServicePort,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: DemoteParticipantInput,
  ): Promise<LiveParticipant> {
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

    const participant = await this.liveParticipantRepository.find(
      input.liveId,
      input.targetLiveParticipantId,
    );
    if (!participant) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveParticipant ${input.targetLiveParticipantId} not found in live ${input.liveId}`,
      );
    }

    if (!participant.capabilities.includes('PUBLISH')) {
      return participant;
    }

    if (!live.stageArn) {
      throw new ConflictError(
        'A sala ainda não está pronta.',
        'STAGE_NOT_PROVISIONED',
        `LiveSession ${input.liveId} has no stageArn yet`,
      );
    }

    if (participant.ivsParticipantId) {
      await this.ivsRealTimeService.disconnectParticipant({
        stageArn: live.stageArn,
        ivsParticipantId: participant.ivsParticipantId,
        reason: 'Rebaixado de apresentador',
      });
    }

    const demoted: LiveParticipant = {
      ...participant,
      capabilities: IVS_TOKEN_CAPABILITIES_BY_ROLE.SUBSCRIBER_ONLY,
    };
    await this.liveParticipantRepository.save(demoted);

    return demoted;
  }
}
