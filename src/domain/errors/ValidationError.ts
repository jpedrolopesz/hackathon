import { DomainError } from './DomainError';

export type ValidationIssue = {
  path: string;
  message: string;
};

export class ValidationError extends DomainError {
  readonly details: ReadonlyArray<ValidationIssue>;

  constructor(
    publicMessage: string,
    code = 'VALIDATION_ERROR',
    details: ReadonlyArray<ValidationIssue> = [],
    internalMessage?: string,
  ) {
    super(publicMessage, code, internalMessage);
    this.details = details;
  }
}
