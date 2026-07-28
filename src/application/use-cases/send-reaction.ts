import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import { REACTION_MAX_LENGTH } from '@/application/realtime/realtime-limits';
import type { RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import { ValidationError } from '@/domain/errors/ValidationError';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';

export interface SendReactionInput {
  readonly emoji: string;
}

export interface ReactionSent {
  readonly liveParticipantId: string;
  readonly emoji: string;
}

/**
 * Reações não tocam o DynamoDB — nem para persistir, nem para rate limit (revisão de
 * ponto de revisão: o rate limiter em DynamoDB dava um custo de escrita real por
 * reação, o oposto do que a Fase 1 tinha decidido). A frequência é limitada no próprio
 * API Gateway WebSocket, na rota `reaction.send` (`infrastructure/stacks/api-stack.ts`,
 * `RouteSettings.throttlingRateLimit/BurstLimit`) — infraestrutura, sem escrita. É um
 * limite agregado da rota inteira, não por aluno (docs/fase-1-arquitetura.md, seção
 * 10.7): suficiente para proteger o backend de um pico, mas não impede sozinho um
 * usuário individual de consumir mais do que a parte que lhe cabia do orçamento.
 */
export class SendReactionUseCase {
  constructor(
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly broadcaster: RealtimeBroadcaster,
  ) {}

  async execute(connection: LiveConnectionContext, input: SendReactionInput): Promise<void> {
    const emoji = input.emoji.trim();
    if (emoji.length === 0 || emoji.length > REACTION_MAX_LENGTH) {
      throw new ValidationError('Reação inválida.', 'REACTION_INVALID');
    }

    const reaction: ReactionSent = { liveParticipantId: connection.liveParticipantId, emoji };
    await broadcastToLive(
      this.webSocketConnectionRepository,
      this.broadcaster,
      connection.liveId,
      buildEnvelope('reaction.sent', connection.liveId, reaction),
    );
  }
}
