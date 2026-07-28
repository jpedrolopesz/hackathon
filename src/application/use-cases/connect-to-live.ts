import {
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { AttendanceRepository } from '@/application/ports/AttendanceRepository';
import type { LiveParticipantRepository } from '@/application/ports/LiveParticipantRepository';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { WebSocketConnection } from '@/domain/entities/WebSocketConnection';

export interface ConnectToLiveInput {
  readonly liveId: string;
  readonly connectionId: string;
}

const CONNECTABLE_STATUSES = ['WAITING', 'LIVE', 'ENDING'] as const;

/**
 * Autorização de identidade (JWT) já aconteceu no Lambda authorizer do `$connect`
 * (docs/fase-1-arquitetura.md, seção 10.1) — `context` chega aqui já resolvido, mesmo
 * raciocínio de `JoinLiveUseCase`. O que falta verificar é específico da live: mesma
 * instituição e, principalmente, que o usuário já tenha um `LiveParticipant` — ele só
 * existe depois de um `join` bem-sucedido (HTTP), que é quando o token IVS é emitido.
 * Uma conexão WebSocket sem `LiveParticipant` não tem `liveParticipantId` para gravar
 * na conexão nem faz sentido de negócio (chat de quem não entrou na aula).
 */
export class ConnectToLiveUseCase {
  constructor(
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly liveParticipantRepository: LiveParticipantRepository,
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly attendanceRepository: AttendanceRepository,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: ConnectToLiveInput,
  ): Promise<WebSocketConnection> {
    const live = await this.liveSessionRepository.findById(input.liveId);
    if (!live) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${input.liveId} not found`,
      );
    }

    assertSameInstitution(context, live.institutionId);

    if (!CONNECTABLE_STATUSES.includes(live.status as (typeof CONNECTABLE_STATUSES)[number])) {
      throw new ConflictError(
        'Esta aula não está disponível no momento.',
        'LIVE_NOT_AVAILABLE',
        `LiveSession ${input.liveId} has status ${live.status}`,
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

    const connection: WebSocketConnection = {
      connectionId: input.connectionId,
      liveId: input.liveId,
      userId: context.userId,
      liveParticipantId: participant.liveParticipantId,
      role: context.role,
      connectedAt: new Date().toISOString(),
    };
    await this.webSocketConnectionRepository.save(connection);

    // Presença (padrão #12) — chaveada por liveParticipantId, nunca por connectionId
    // (docs/fase-1-arquitetura.md, seção 10.8/13): idempotente, reconexão não duplica.
    await this.attendanceRepository.markPresent(
      input.liveId,
      participant.liveParticipantId,
      context.userId,
      connection.connectedAt,
    );

    return connection;
  }
}
