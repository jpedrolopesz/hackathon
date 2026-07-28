export type Role = 'ADMIN' | 'PROFESSOR' | 'ALUNO';

export const ROLES: readonly Role[] = ['ADMIN', 'PROFESSOR', 'ALUNO'];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
