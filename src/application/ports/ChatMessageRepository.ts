import type { ChatMessage } from '@/domain/entities/ChatMessage';

export interface ChatMessagePage {
  readonly messages: readonly ChatMessage[];
  /** Ausente = não há mais páginas. Opaco — ver docs/fase-1-arquitetura.md, seção 10.2. */
  readonly nextCursor?: string;
}

export interface ChatMessagesSinceResult {
  readonly messages: readonly ChatMessage[];
  /**
   * `true` se algum shard pode ter mensagens além do que foi buscado (o lote bateu
   * no teto por shard e nenhum item mais antigo que `since` apareceu, então não há
   * como saber se a lacuna real é maior). Nunca fica em silêncio — ver
   * `ResumeLiveSyncUseCase` e docs/fase-1-arquitetura.md, seção 10.8.
   */
  readonly truncated: boolean;
}

export interface ChatMessageRepository {
  save(message: ChatMessage): Promise<void>;
  /** `messageId` no formato `{shard}#{ulid}` — o shard é extraído dele, sem Query. */
  deleteById(liveId: string, messageId: string): Promise<void>;
  /** Mais recentes primeiro. Fan-out sobre todos os shards + merge por timestamp. */
  list(liveId: string, pageSize: number, cursor?: string): Promise<ChatMessagePage>;
  /**
   * Mensagens mais recentes que `since`, mais antigas primeiro — usado por
   * `sync.resume` para preencher a lacuna de uma reconexão (docs/fase-1-arquitetura.md,
   * seção 10.8). Busca limitada por shard: uma lacuna maior que o teto num único shard
   * não é totalmente preenchida — degradação aceita, pensada para lacunas de
   * reconexão (minutos), não para recarregar o histórico inteiro da aula. Quando isso
   * acontece, `truncated: true` avisa o chamador explicitamente.
   */
  listSince(liveId: string, since: string): Promise<ChatMessagesSinceResult>;
}
