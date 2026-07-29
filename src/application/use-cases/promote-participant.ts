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
import {
  assertNoSensitiveTokenFields,
  assertValidCapabilities,
  buildParticipantTokenAttributes,
  buildParticipantTokenUserId,
  IVS_TOKEN_CAPABILITIES_BY_ROLE,
} from '@/infrastructure/aws/ivs/participant-token-attributes';
import { participantTokenDurationMinutes } from '@/application/live/participant-token-duration';
import { emitMetric } from '@/shared/observability/structured-log';

export interface PromoteParticipantInput {
  readonly liveId: string;
  readonly targetLiveParticipantId: string;
}

export interface PromoteParticipantResult {
  readonly participant: LiveParticipant;
  /** Ausente no caminho idempotente (já promovido) — nada de novo para o cliente usar. */
  readonly participantToken?: { readonly token: string; readonly expiresAt: string };
}

/**
 * Verificado na doc oficial (docs/fase-1-arquitetura.md, seção 4): Token Exchange do
 * IVS não funciona com tokens do `CreateParticipantToken` — só com tokens
 * autoassinados via key pair. Promoção usa reemissão de token. Isso é seguro nesse
 * sentido: o pior caso de o token SUBSCRIBE-only antigo continuar "válido" é um aluno
 * continuar podendo assistir — não há capability elevada em risco (contraste com
 * `DemoteParticipantUseCase`, que precisa de `DisconnectParticipant`).
 */
export class PromoteParticipantUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly liveParticipantRepository: LiveParticipantRepository,
    private readonly ivsRealTimeService: IvsRealTimeServicePort,
    private readonly participantTokenMaximumMinutes = 720,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: PromoteParticipantInput,
  ): Promise<PromoteParticipantResult> {
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

    if (!live.stageArn) {
      throw new ConflictError(
        'A sala ainda não está pronta.',
        'STAGE_NOT_PROVISIONED',
        `LiveSession ${input.liveId} has no stageArn yet`,
      );
    }

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

    if (participant.capabilities.includes('PUBLISH')) {
      return { participant };
    }

    const capabilities = IVS_TOKEN_CAPABILITIES_BY_ROLE.PRESENTER;
    assertValidCapabilities(capabilities);
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
      capabilities,
      durationMinutes: tokenDurationMinutes,
    });

    const promoted: LiveParticipant = {
      ...participant,
      capabilities,
      ivsParticipantId: createdToken.ivsParticipantId,
      promotedAt: new Date().toISOString(),
    };
    await this.liveParticipantRepository.save(promoted);
    emitMetric('PresentersPromoted');

    return {
      participant: promoted,
      participantToken: { token: createdToken.token, expiresAt: createdToken.expiresAt },
    };
  }
}
