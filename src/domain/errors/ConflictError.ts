import { DomainError } from './DomainError';

export class ConflictError extends DomainError {
  constructor(publicMessage: string, code = 'CONFLICT', internalMessage?: string) {
    super(publicMessage, code, internalMessage);
  }
}
