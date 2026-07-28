import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import { assertRole } from '@/application/authorization/guards';
import type { ChatMessageRepository } from '@/application/ports/ChatMessageRepository';
import type { RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';

export interface DeleteChatMessageInput {
  readonly messageId: string;
}

/**
 * Moderação (seção 8 do README). `assertRole` aqui usa só `context.role`, já resolvido
 * na conexão — não há dono de recurso para checar como em `assertClassOwner`: qualquer
 * professor/admin da própria live pode moderar (a live já é escopada pela conexão).
 * `deleteById` extrai o shard direto do `messageId`, sem Query (docs/fase-1-
 * arquitetura.md, seção 10.2) — por isso não precisamos carregar a mensagem antes.
 */
export class DeleteChatMessageUseCase {
  constructor(
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly broadcaster: RealtimeBroadcaster,
  ) {}

  async execute(connection: LiveConnectionContext, input: DeleteChatMessageInput): Promise<void> {
    assertRole(connection, ['PROFESSOR', 'ADMIN']);

    await this.chatMessageRepository.deleteById(connection.liveId, input.messageId);

    await broadcastToLive(
      this.webSocketConnectionRepository,
      this.broadcaster,
      connection.liveId,
      buildEnvelope('chat.message.deleted', connection.liveId, { messageId: input.messageId }),
    );
  }
}
