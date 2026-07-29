import { ForbiddenError } from '@/domain/errors/ForbiddenError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { Role } from '@/domain/value-objects/Role';
import type { AuthenticatedRequestContext } from './AuthenticatedRequestContext';

/** Qualquer entidade "dona de uma turma" — `ClassGroup` e `LiveSession` (que
 * denormaliza `teacherId`) satisfazem isso estruturalmente. */
export interface OwnedByClassTeacher {
  readonly classId: string;
  readonly teacherId: string;
}

/**
 * Única fonte de verdade para "recurso institucional não encontrado" — tanto o check
 * de existência quanto `assertSameInstitution` usam exatamente estes dois valores, de
 * propósito: garante que as duas respostas sejam byte-a-byte idênticas (ver teste em
 * tests/unit/application/authorization/anti-enumeration.test.ts).
 */
export const RESOURCE_NOT_FOUND_PUBLIC_MESSAGE = 'Recurso não encontrado.';
export const RESOURCE_NOT_FOUND_CODE = 'RESOURCE_NOT_FOUND';

/**
 * Seção 14 do README proíbe enumeração de recursos. Um 403 com código específico
 * (`CROSS_INSTITUTION_ACCESS_DENIED`) confirma ao atacante que o recurso EXISTE em
 * outra instituição — é a própria enumeração que a seção 14 manda evitar. Por isso
 * isto é um 404 genérico, não um 403: quem está fora da instituição não consegue
 * distinguir "não existe" de "existe, não é seu". O motivo real (cross-institution, os
 * IDs envolvidos) só vai no `internalMessage`, nunca na resposta.
 *
 * Contraste com `assertClassOwner` abaixo: um professor mexendo em turma de outro
 * professor DENTRO da mesma instituição já sabe legitimamente que ela existe (está no
 * catálogo da própria instituição) — ali 403+`CLASS_NOT_OWNED` não vaza nada, por isso
 * continua sendo Forbidden.
 */
export function assertSameInstitution(
  context: AuthenticatedRequestContext,
  resourceInstitutionId: string,
): void {
  if (context.institutionId !== resourceInstitutionId) {
    throw new NotFoundError(
      RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
      RESOURCE_NOT_FOUND_CODE,
      `User ${context.userId} (institution ${context.institutionId}) tried to access a resource from institution ${resourceInstitutionId}`,
    );
  }
}

/** Qualquer identidade resolvida com papel — `AuthenticatedRequestContext` e
 * `LiveConnectionContext` (contexto de conexão WebSocket, sem `institutionId`) ambos
 * satisfazem isso estruturalmente. */
export interface HasRole {
  readonly userId: string;
  readonly role: Role;
}

export function assertRole(context: HasRole, allowed: readonly Role[]): void {
  if (!allowed.includes(context.role)) {
    throw new ForbiddenError(
      'Você não tem permissão para executar esta ação.',
      'ROLE_NOT_ALLOWED',
      `User ${context.userId} has role ${context.role}, expected one of ${allowed.join(', ')}`,
    );
  }
}

/**
 * Seção 17 do README lista "professor tentando editar live de outra turma" como caso
 * crítico. Este guard protege recursos operacionais da turma (como LiveSession):
 * ADMIN sempre pode; PROFESSOR só se for o dono (`teacherId`); qualquer outro papel
 * (inclusive ALUNO) cai no branch de erro. A entidade administrativa ClassGroup usa
 * `assertRole(ADMIN)` diretamente.
 */
export function assertClassOwner(
  context: AuthenticatedRequestContext,
  resource: OwnedByClassTeacher,
): void {
  if (context.role === 'ADMIN') {
    return;
  }

  if (context.role === 'PROFESSOR' && resource.teacherId === context.userId) {
    return;
  }

  throw new ForbiddenError(
    'Você não tem permissão para gerenciar esta turma.',
    'CLASS_NOT_OWNED',
    `User ${context.userId} (role ${context.role}) tried to manage class ${resource.classId} owned by ${resource.teacherId}`,
  );
}
