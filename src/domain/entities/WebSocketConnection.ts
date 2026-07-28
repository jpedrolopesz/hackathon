import type { Role } from '../value-objects/Role';

/**
 * Chave: PK=LIVE#{liveId}, SK=CONNECTION#{connectionId} (padrão de acesso #11,
 * broadcast). GSI2PK=CONNECTION#{connectionId} / GSI2SK=CONNECTION#{connectionId}
 * para o lookup reverso no `$disconnect`. TTL como rede de segurança contra
 * `$disconnect` perdido.
 */
export interface WebSocketConnection {
  readonly connectionId: string;
  readonly liveId: string;
  readonly userId: string;
  readonly liveParticipantId: string;
  readonly role: Role;
  readonly connectedAt: string;
}
