import type { Role } from '@/domain/value-objects/Role';

/**
 * Identidade de quem fala numa conexão WebSocket já aberta — resolvida uma única vez
 * em `ConnectToLiveUseCase` (a partir do `AuthenticatedRequestContext` que o
 * authorizer monta) e persistida em `WebSocketConnection`. Ações subsequentes (chat,
 * pergunta, reação, voto) não repetem a checagem de instituição/matrícula: ela já
 * aconteceu no `$connect`. `liveId`/`liveParticipantId`/`role` vêm sempre da conexão
 * armazenada, nunca do corpo da mensagem — o cliente não pode alegar ser outra pessoa
 * só mudando o payload.
 */
export interface LiveConnectionContext {
  readonly liveId: string;
  readonly userId: string;
  readonly liveParticipantId: string;
  readonly role: Role;
}
