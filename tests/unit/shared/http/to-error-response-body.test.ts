import { describe, expect, it } from 'vitest';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import { ServiceUnavailableError } from '@/domain/errors/ServiceUnavailableError';
import { ValidationError } from '@/domain/errors/ValidationError';
import { toErrorResponseBody } from '@/shared/http/toErrorResponseBody';

describe('toErrorResponseBody', () => {
  it('maps a domain error to its http status and code', () => {
    const { status, body } = toErrorResponseBody(new NotFoundError('não encontrado'), 'req-1');
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe('req-1');
  });

  it('maps ServiceUnavailableError (IVS throttling) to 503, never 500', () => {
    const { status, body } = toErrorResponseBody(
      new ServiceUnavailableError('Tente novamente em instantes.'),
      'req-throttled',
    );
    expect(status).toBe(503);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('includes validation details when present', () => {
    const { body } = toErrorResponseBody(
      new ValidationError('inválido', 'VALIDATION_ERROR', [
        { path: 'title', message: 'obrigatório' },
      ]),
      'req-2',
    );
    expect(body.error.details).toEqual([{ path: 'title', message: 'obrigatório' }]);
  });

  it('replaces any unexpected error with a fixed, generic public message', () => {
    const { status, body } = toErrorResponseBody(new Error('stack trace leak'), 'req-3');
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // Asserção positiva: trava o literal exato, não só "não contém X" — garante que
    // nenhum caminho futuro passe a interpolar error.message no catch-all genérico.
    expect(body.error.message).toBe('Ocorreu um erro inesperado. Tente novamente mais tarde.');
  });

  it('never reflects a .message field from a non-Error thrown value either', () => {
    const thrown = {
      message: 'DynamoDB table hackathon-core-prod not found',
      code: 'ResourceNotFoundException',
    };
    const { status, body } = toErrorResponseBody(thrown, 'req-5');
    expect(status).toBe(500);
    expect(body.error.message).toBe('Ocorreu um erro inesperado. Tente novamente mais tarde.');
    expect(JSON.stringify(body)).not.toContain('hackathon-core-prod');
  });

  it('never serializes internalMessage identifiers in the response body', () => {
    const error = new NotFoundError(
      'Aula não encontrada.',
      'NOT_FOUND',
      'LiveSession 3f9a21d4-6c1b-4e2a-9c3e-2a6f9b1d7e55 not found in table',
    );
    const { body } = toErrorResponseBody(error, 'req-4');

    expect(body.error.message).toBe('Aula não encontrada.');
    expect(JSON.stringify(body)).not.toContain('3f9a21d4-6c1b-4e2a-9c3e-2a6f9b1d7e55');
  });
});
