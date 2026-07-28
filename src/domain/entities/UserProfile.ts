import type { Role } from '../value-objects/Role';

/**
 * Chave: PK=USER#{userId}, SK=PROFILE (padrão de acesso #1 — GetItem consistente,
 * decide autorização). `userId` é o `sub` do Cognito.
 */
export interface UserProfile {
  readonly userId: string;
  readonly institutionId: string;
  readonly role: Role;
  readonly name: string;
  readonly email: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
