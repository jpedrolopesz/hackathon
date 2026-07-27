import { DomainError } from './DomainError';

export class ForbiddenError extends DomainError {
  constructor(publicMessage: string, code = 'FORBIDDEN', internalMessage?: string) {
    super(publicMessage, code, internalMessage);
  }
}
