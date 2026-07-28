import { randomUUID } from 'node:crypto';

/** Envelope padronizado da seção 8 do README para toda mensagem WebSocket. */
export interface RealtimeEnvelope<T> {
  readonly type: string;
  readonly eventId: string;
  readonly liveId: string;
  readonly timestamp: string;
  readonly data: T;
}

export function buildEnvelope<T>(type: string, liveId: string, data: T): RealtimeEnvelope<T> {
  return { type, eventId: randomUUID(), liveId, timestamp: new Date().toISOString(), data };
}
