import { describe, expect, it } from 'vitest';
import { ConflictError } from '@/domain/errors/ConflictError';
import { ForbiddenError } from '@/domain/errors/ForbiddenError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import { UnauthorizedError } from '@/domain/errors/UnauthorizedError';
import { ValidationError } from '@/domain/errors/ValidationError';

describe('domain errors', () => {
  it('applies default error codes per error type', () => {
    expect(new NotFoundError('não encontrado').code).toBe('NOT_FOUND');
    expect(new ForbiddenError('sem acesso').code).toBe('FORBIDDEN');
    expect(new UnauthorizedError('não autenticado').code).toBe('UNAUTHORIZED');
    expect(new ConflictError('conflito').code).toBe('CONFLICT');
    expect(new ValidationError('inválido').code).toBe('VALIDATION_ERROR');
  });

  it('allows overriding the error code for a more specific case', () => {
    const error = new ForbiddenError('Você não possui acesso a esta aula.', 'LIVE_ACCESS_DENIED');
    expect(error.code).toBe('LIVE_ACCESS_DENIED');
    expect(error.publicMessage).toBe('Você não possui acesso a esta aula.');
  });

  it('defaults internalMessage to publicMessage when not provided', () => {
    const error = new NotFoundError('Aula não encontrada.');
    expect(error.internalMessage).toBe('Aula não encontrada.');
    expect(error.message).toBe('Aula não encontrada.');
  });

  it('keeps internalMessage separate from publicMessage when both are provided', () => {
    const error = new NotFoundError(
      'Aula não encontrada.',
      'NOT_FOUND',
      'LiveSession 3f9a21d4-6c1b-4e2a-9c3e-2a6f9b1d7e55 not found in table',
    );
    expect(error.publicMessage).toBe('Aula não encontrada.');
    expect(error.internalMessage).toContain('3f9a21d4-6c1b-4e2a-9c3e-2a6f9b1d7e55');
    // Error.message reflete a mensagem interna: é o que aparece em stack traces/CloudWatch.
    expect(error.message).toBe(error.internalMessage);
  });

  it('carries validation issue details', () => {
    const error = new ValidationError('dados inválidos', 'VALIDATION_ERROR', [
      { path: 'email', message: 'obrigatório' },
    ]);
    expect(error.details).toEqual([{ path: 'email', message: 'obrigatório' }]);
  });
});
