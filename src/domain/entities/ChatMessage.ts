import type { Role } from '../value-objects/Role';

/**
 * `messageId` é `{shard}#{ulid}`, exposto assim para a API (docs/fase-1-
 * arquitetura.md, seção 10.2) — a moderação extrai o shard direto do id, sem Query.
 * Chave real: PK=LIVE#{liveId}#{shard}, SK=CHAT#{ulid}.
 */
export interface ChatMessage {
  readonly messageId: string;
  readonly liveId: string;
  readonly shard: number;
  /** UUID do LiveParticipant — nunca o sub do Cognito (mesma regra dos tokens IVS). */
  readonly authorLiveParticipantId: string;
  readonly authorRole: Role;
  readonly body: string;
  readonly createdAt: string;
}
