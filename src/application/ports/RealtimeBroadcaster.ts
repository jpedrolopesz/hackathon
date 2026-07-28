export type BroadcastResult = 'sent' | 'stale';

/** Adapter para a API de gerenciamento do API Gateway WebSocket (PostToConnection). */
export interface RealtimeBroadcaster {
  /** 'stale' sinaliza uma conexão morta (410 Gone) — o chamador deve limpá-la. */
  send(connectionId: string, payload: unknown): Promise<BroadcastResult>;
}
