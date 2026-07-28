import type { WebSocketConnection } from '@/domain/entities/WebSocketConnection';

export interface WebSocketConnectionRepository {
  save(connection: WebSocketConnection): Promise<void>;
  findByConnectionId(connectionId: string): Promise<WebSocketConnection | null>;
  removeByConnectionId(connectionId: string): Promise<void>;
  /** Padrão de acesso #11 (broadcast) — leitura forte, ver docs/fase-1-arquitetura.md seção 10.5. */
  listByLive(liveId: string): Promise<readonly WebSocketConnection[]>;
}
