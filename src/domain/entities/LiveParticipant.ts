import type { Role } from '../value-objects/Role';

export type ParticipantCapability = 'PUBLISH' | 'SUBSCRIBE';

/**
 * Chave: PK=LIVE#{liveId}, SK=PARTICIPANT#{liveParticipantId} (padrão de acesso #7).
 * GSI3 esparso (GSI3PK=LIVE#{liveId}#PRESENTERS / GSI3SK=PARTICIPANT#{liveParticipantId})
 * só existe enquanto `capabilities` inclui `PUBLISH` — ver docs/fase-1-arquitetura.md.
 *
 * `liveParticipantId` (UUID cunhado por nós) é a identidade usada em TODO lugar do
 * domínio — presença, lista de participantes, apresentadores. `ivsParticipantId` (o
 * `participantId` que o IVS atribui em cada `CreateParticipantToken`) nunca é chave de
 * nada aqui: serve só para correlacionar eventos do EventBridge de volta a este
 * registro. A doc oficial não deixa claro se o `participantId` muda a cada renovação
 * de token; a regra vale independente da resposta (ver docs/fase-1-arquitetura.md).
 */
export interface LiveParticipant {
  readonly liveParticipantId: string;
  readonly liveId: string;
  readonly userId: string;
  readonly role: Role;
  readonly capabilities: readonly ParticipantCapability[];
  readonly ivsParticipantId?: string;
  readonly joinedAt: string;
  readonly promotedAt?: string;
}
