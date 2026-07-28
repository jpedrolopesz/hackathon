import type { Role } from '@/domain/value-objects/Role';

/**
 * Identidade resolvida do requisitante — `role`/`institutionId` sempre vêm do
 * `UserProfile` no DynamoDB, nunca de um claim do JWT nem do corpo da requisição
 * (docs/fase-1-arquitetura.md, seção 2 "Convergência"; regra da seção 5 do README).
 */
export interface AuthenticatedRequestContext {
  readonly userId: string;
  readonly institutionId: string;
  readonly role: Role;
}
