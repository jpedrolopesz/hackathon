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
  assertValidDurationMinutes,
  buildParticipantTokenAttributes,
  buildParticipantTokenUserId,
} from '@/infrastructure/aws/ivs/participant-token-attributes';

export interface RefreshParticipantTokenInput {
  readonly liveId: string;
}

export interface RefreshParticipantTokenResult {
  readonly participantToken: string;
  readonly expiresAt: string;
}

// Mesma duração de `JoinLiveUseCase`/`PromoteParticipantUseCase` — ver nota lá sobre
// por que 180min (3h), não o default da API (720min/12h, confirmado na doc oficial
// da action `CreateParticipantToken`: "Default: 720 (12 hours)").
const REFRESH_TOKEN_DURATION_MINUTES = 180;

/**
 * `POST /lives/{liveId}/token/refresh` — seção 13 do README, ponto de revisão da
 * Fase 8: o participant token do IVS tem validade limitada (180min, ver acima); uma
 * aula pode durar mais que isso, e o cliente do estúdio (Web Broadcast SDK) precisa
 * renovar o token ANTES de expirar, sem cair a publicação (a troca de token do SDK é
 * transparente para a sessão WebRTC já estabelecida — só a AUTORIZAÇÃO é renovada,
 * a conexão de mídia não é recriada).
 *
 * Diferente de `PromoteParticipantUseCase`: aqui as capabilities NÃO mudam — é
 * sempre uma reemissão nas MESMAS capabilities que o participante já tinha (nunca
 * eleva PUBLISH sozinho; quem decide isso é `PromoteParticipantUseCase`). Diferente
 * de `DemoteParticipantUseCase`: não desconecta ninguém — é sempre o próprio
 * participante renovando o token que já é seu, não uma ação de moderação sobre
 * outra pessoa.
 */
export class RefreshParticipantTokenUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly liveParticipantRepository: LiveParticipantRepository,
    private readonly ivsRealTimeService: IvsRealTimeServicePort,
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
    assertValidDurationMinutes(REFRESH_TOKEN_DURATION_MINUTES);

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
      durationMinutes: REFRESH_TOKEN_DURATION_MINUTES,
    });

    await this.liveParticipantRepository.save({
      ...participant,
      ivsParticipantId: createdToken.ivsParticipantId,
    });

    return { participantToken: createdToken.token, expiresAt: createdToken.expiresAt };
  }
}
