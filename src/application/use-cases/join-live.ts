import { randomUUID } from 'node:crypto';
import {
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { ConnectionTicketRepository } from '@/application/ports/ConnectionTicketRepository';
import type { EnrollmentRepository } from '@/application/ports/EnrollmentRepository';
import type { IvsRealTimeServicePort } from '@/application/ports/IvsRealTimeServicePort';
import type { LiveParticipantRepository } from '@/application/ports/LiveParticipantRepository';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { issueConnectionTicket } from '@/application/realtime/issue-connection-ticket';
import { ConflictError } from '@/domain/errors/ConflictError';
import { ForbiddenError } from '@/domain/errors/ForbiddenError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { LiveParticipant } from '@/domain/entities/LiveParticipant';
import type { LiveSession } from '@/domain/entities/LiveSession';
import {
  assertNoSensitiveTokenFields,
  assertValidCapabilities,
  buildParticipantTokenAttributes,
  buildParticipantTokenUserId,
  IVS_TOKEN_CAPABILITIES_BY_ROLE,
} from '@/infrastructure/aws/ivs/participant-token-attributes';
import { participantTokenDurationMinutes } from '@/application/live/participant-token-duration';
import { emitMetric } from '@/shared/observability/structured-log';

export interface JoinLiveInput {
  readonly liveId: string;
}

export interface JoinLiveResult {
  readonly live: LiveSession;
  readonly participant: LiveParticipant;
  readonly ivs: {
    readonly stageArn: string;
    readonly participantToken: string;
    readonly expiresAt: string;
  };
  readonly realtime: {
    readonly connectionToken: string;
    readonly expiresAt: string;
  };
}

/**
 * As seis verificações da seção 6 do README, na ordem exata (docs/fase-1-
 * arquitetura.md, seção 3). `capabilities` é sempre montado explicitamente — nunca
 * omitido — porque o default da API é `PUBLISH`+`SUBSCRIBE`.
 */
export class JoinLiveUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly enrollmentRepository: EnrollmentRepository,
    private readonly liveParticipantRepository: LiveParticipantRepository,
    private readonly ivsRealTimeService: IvsRealTimeServicePort,
    private readonly connectionTicketRepository: ConnectionTicketRepository,
    private readonly participantTokenMaximumMinutes = 720,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: JoinLiveInput,
  ): Promise<JoinLiveResult> {
    // 1. Autenticado — já garantido: AuthenticatedRequestContext só existe depois da
    // validação do JWT (docs/fase-1-arquitetura.md, seção 2).
    const live = await this.liveSessionRepository.findById(input.liveId);
    if (!live) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${input.liveId} not found`,
      );
    }

    // 2. Pertence à instituição.
    assertSameInstitution(context, live.institutionId);

    // 3. Possui acesso ao curso/turma.
    const isOwner = context.role === 'PROFESSOR' && live.teacherId === context.userId;
    if (context.role === 'ALUNO') {
      const enrollment = await this.enrollmentRepository.find(context.userId, live.classId);
      if (!enrollment || enrollment.status !== 'ACTIVE') {
        throw new NotFoundError(
          RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
          RESOURCE_NOT_FOUND_CODE,
          `Student ${context.userId} is not (actively) enrolled in class ${live.classId}`,
        );
      }
    } else if (context.role === 'PROFESSOR' && !isOwner) {
      throw new ForbiddenError(
        'Você não tem permissão para entrar nesta aula.',
        'CLASS_NOT_OWNED',
        `Professor ${context.userId} does not own class ${live.classId}`,
      );
    }

    // 4. Live disponível.
    if (live.status !== 'WAITING' && live.status !== 'LIVE') {
      throw new ConflictError(
        'Esta aula não está disponível no momento.',
        'LIVE_NOT_AVAILABLE',
        `LiveSession ${input.liveId} has status ${live.status}`,
      );
    }
    if (!live.stageArn) {
      throw new ConflictError(
        'A sala ainda está sendo preparada. Tente novamente em instantes.',
        'STAGE_NOT_PROVISIONED',
        `LiveSession ${input.liveId} has no stageArn yet`,
      );
    }

    // 5. Função efetiva — idempotente: reaproveita o LiveParticipant se já existir
    // (reentrada/reconexão), preservando promoção e joinedAt originais.
    const existingParticipant = await this.liveParticipantRepository.findByUser(
      input.liveId,
      context.userId,
    );
    const isPromoted = existingParticipant?.capabilities.includes('PUBLISH') ?? false;

    // 6. Capabilities — mapeamento fixo da seção 6, sempre explícito.
    const capabilities =
      isOwner || context.role === 'ALUNO' || isPromoted
        ? IVS_TOKEN_CAPABILITIES_BY_ROLE.PRESENTER
        : IVS_TOKEN_CAPABILITIES_BY_ROLE.SUBSCRIBER_ONLY;
    assertValidCapabilities(capabilities);
    const tokenDurationMinutes = participantTokenDurationMinutes(
      live,
      this.participantTokenMaximumMinutes,
    );

    const liveParticipantId = existingParticipant?.liveParticipantId ?? randomUUID();
    const tokenIdentity = { liveParticipantId, role: context.role };
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
    emitMetric('ParticipantTokensCreated');

    const now = new Date().toISOString();
    const participant: LiveParticipant = {
      liveParticipantId,
      liveId: input.liveId,
      userId: context.userId,
      role: context.role,
      capabilities,
      ivsParticipantId: createdToken.ivsParticipantId,
      joinedAt: existingParticipant?.joinedAt ?? now,
      ...(existingParticipant?.promotedAt !== undefined
        ? { promotedAt: existingParticipant.promotedAt }
        : {}),
    };
    await this.liveParticipantRepository.save(participant);
    emitMetric('ParticipantsJoined', 1, 'Count', { Role: context.role });

    // Ticket de conexão do WebSocket (seção 11 do README, `realtime.connectionToken`)
    // — nunca o access token do Cognito na URL (revisão de segurança pós-Fase-6,
    // docs/fase-1-arquitetura.md, seção 10.1). Emitido aqui só para a conexão inicial;
    // reconexões subsequentes usam `IssueConnectionTicketUseCase` (seção 10.9) — que
    // NÃO reemite token IVS nem toca `LiveParticipant` — para não gastar o teto de 50
    // TPS do `CreateParticipantToken` a cada reconexão de WebSocket (transporte
    // independente do stage IVS: a queda de um não derruba o outro).
    const realtime = await issueConnectionTicket(
      this.connectionTicketRepository,
      input.liveId,
      context.userId,
    );

    return {
      live,
      participant,
      ivs: {
        stageArn: live.stageArn,
        participantToken: createdToken.token,
        expiresAt: createdToken.expiresAt,
      },
      realtime,
    };
  }
}
