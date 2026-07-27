import { ConflictError } from '@/domain/errors/ConflictError';
import { ForbiddenError } from '@/domain/errors/ForbiddenError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import { UnauthorizedError } from '@/domain/errors/UnauthorizedError';
import { ValidationError } from '@/domain/errors/ValidationError';
import type { DomainError } from '@/domain/errors/DomainError';

export function httpStatusForError(error: DomainError): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof UnauthorizedError) return 401;
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  return 500;
}
