import {
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
import {
  assertNoSensitiveTokenFields,
  assertValidCapabilities,
  buildParticipantTokenAttributes,
  buildParticipantTokenUserId,
} from '@/infrastructure/aws/ivs/participant-token-attributes';
import { participantTokenDurationMinutes } from '@/application/live/participant-token-duration';

export interface RefreshParticipantTokenInput {
  readonly liveId: string;
}

export interface RefreshParticipantTokenResult {
  readonly participantToken: string;
  readonly expiresAt: string;
}

/**
 * `POST /lives/{liveId}/token/refresh` — seção 13 do README, ponto de revisão da
 * Fase 8: o participant token cobre a duração agendada + margem, limitado pelo teto
 * do ambiente; refresh é exceção para uma aula que estourou o horário. Como estes
 * tokens vêm de `CreateParticipantToken`,
 * eles NÃO são aceitos por `Stage.exchangeToken()` (a troca só aceita tokens
 * autoassinados com key pair). O cliente precisa sair, recriar o `Stage` com este
 * token reemitido e entrar novamente; isso interrompe brevemente a publicação.
 *
 * Diferente de `PromoteParticipantUseCase`: aqui as capabilities NÃO mudam — é
 * sempre uma reemissão nas MESMAS capabilities que o participante já tinha (nunca
 * eleva PUBLISH sozinho; quem decide isso é `PromoteParticipantUseCase`). Diferente
 * de `DemoteParticipantUseCase`: não desconecta ninguém — é sempre o próprio
 * participante renovando o token que já é seu, não uma ação de moderação sobre
 * outra pessoa. A nova emissão recebe um novo `ivsParticipantId`, mas preserva o
 * `liveParticipantId` estável do domínio.
 */
export class RefreshParticipantTokenUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly liveParticipantRepository: LiveParticipantRepository,
    private readonly ivsRealTimeService: IvsRealTimeServicePort,
    private readonly participantTokenMaximumMinutes = 720,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: RefreshParticipantTokenInput,
  ): Promise<RefreshParticipantTokenResult> {
    const live = await this.liveSessionRepository.findById(input.liveId);
    if (!live) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${input.liveId} not found`,
      );
    }
    assertSameInstitution(context, live.institutionId);

    if (!live.stageArn) {
      throw new ConflictError(
        'A sala ainda está sendo preparada. Tente novamente em instantes.',
        'STAGE_NOT_PROVISIONED',
        `LiveSession ${input.liveId} has no stageArn yet`,
      );
    }

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

    assertValidCapabilities(participant.capabilities);
    const tokenDurationMinutes = participantTokenDurationMinutes(
      live,
      this.participantTokenMaximumMinutes,
    );

    const tokenIdentity = {
      liveParticipantId: participant.liveParticipantId,
      role: participant.role,
    };
    const tokenAttributes = buildParticipantTokenAttributes(tokenIdentity);
    const tokenUserId = buildParticipantTokenUserId(tokenIdentity);
    assertNoSensitiveTokenFields({ userId: tokenUserId, attributes: tokenAttributes });

    const createdToken = await this.ivsRealTimeService.createParticipantToken({
      stageArn: live.stageArn,
      userId: tokenUserId,
      attributes: tokenAttributes,
      capabilities: participant.capabilities,
      durationMinutes: tokenDurationMinutes,
    });

    await this.liveParticipantRepository.save({
      ...participant,
      ivsParticipantId: createdToken.ivsParticipantId,
    });

    return { participantToken: createdToken.token, expiresAt: createdToken.expiresAt };
  }
}
