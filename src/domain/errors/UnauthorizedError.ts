import { DomainError } from './DomainError';

export class UnauthorizedError extends DomainError {
  constructor(publicMessage: string, code = 'UNAUTHORIZED', internalMessage?: string) {
    super(publicMessage, code, internalMessage);
  }
}
