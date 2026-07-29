import { ulid } from 'ulid';
import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import { hashUserIdToShard } from '@/application/realtime/chat-shard';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_RATE_LIMIT } from '@/application/realtime/realtime-limits';
import type { ChatMessageRepository } from '@/application/ports/ChatMessageRepository';
import type { RateLimiter } from '@/application/ports/RateLimiter';
import type { RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { ValidationError } from '@/domain/errors/ValidationError';
import type { ChatMessage } from '@/domain/entities/ChatMessage';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';
import { emitMetric } from '@/shared/observability/structured-log';

export interface SendChatMessageInput {
  readonly body: string;
}

/**
 * `shard = hash(userId) % chatShardCount` (docs/fase-1-arquitetura.md, seção 7) — é
 * isso que distribui a escrita entre partições e evita hot partition. `messageId`
 * (`{shard}#{ulid}`) é o que permite `DeleteChatMessageUseCase` apagar sem Query.
 */
export class SendChatMessageUseCase {
  constructor(
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly broadcaster: RealtimeBroadcaster,
    private readonly chatShardCount: number,
  ) {}

  async execute(
    connection: LiveConnectionContext,
    input: SendChatMessageInput,
  ): Promise<ChatMessage> {
    const body = input.body.trim();
    if (body.length === 0 || body.length > CHAT_MESSAGE_MAX_LENGTH) {
      throw new ValidationError(
        `A mensagem deve ter entre 1 e ${CHAT_MESSAGE_MAX_LENGTH} caracteres.`,
        'MESSAGE_INVALID_LENGTH',
      );
    }

    const allowed = await this.rateLimiter.consume(
      `CHAT#${connection.liveId}#${connection.userId}`,
      CHAT_RATE_LIMIT.limit,
      CHAT_RATE_LIMIT.windowSeconds,
    );
    if (!allowed) {
      throw new ConflictError(
        'Você está enviando mensagens rápido demais. Aguarde alguns segundos.',
        'RATE_LIMIT_EXCEEDED',
      );
    }

    const shard = hashUserIdToShard(connection.userId, this.chatShardCount);
    const message: ChatMessage = {
      messageId: `${shard}#${ulid()}`,
      liveId: connection.liveId,
      shard,
      authorLiveParticipantId: connection.liveParticipantId,
      authorRole: connection.role,
      body,
      createdAt: new Date().toISOString(),
    };
    await this.chatMessageRepository.save(message);
    emitMetric('ChatMessages');

    await broadcastToLive(
      this.webSocketConnectionRepository,
      this.broadcaster,
      connection.liveId,
      buildEnvelope('chat.message.created', connection.liveId, message),
    );

    return message;
  }
}
