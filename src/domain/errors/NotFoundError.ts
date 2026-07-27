import { DomainError } from './DomainError';

export class NotFoundError extends DomainError {
  constructor(publicMessage: string, code = 'NOT_FOUND', internalMessage?: string) {
    super(publicMessage, code, internalMessage);
  }
}
