import { DomainError } from '@/domain/errors/DomainError';
import { ValidationError } from '@/domain/errors/ValidationError';
import { errorResponse } from './apiResponse';
import { httpStatusForError } from './httpStatusForError';
import type { ApiErrorResponse } from './apiResponse';

export type ErrorResponsePayload = {
  status: number;
  body: ApiErrorResponse;
};

/**
 * Traduz qualquer erro capturado em um Route Handler para o envelope de
 * resposta padronizado. Erros que não são DomainError nunca têm sua
 * mensagem original exposta (ver seção 14 do README — não vazar detalhes internos).
 */
export function toErrorResponseBody(error: unknown, requestId: string): ErrorResponsePayload {
  if (error instanceof DomainError) {
    const details = error instanceof ValidationError ? error.details : [];

    return {
      status: httpStatusForError(error),
      body: errorResponse({ code: error.code, message: error.publicMessage, details, requestId }),
    };
  }

  return {
    status: 500,
    body: errorResponse({
      code: 'INTERNAL_ERROR',
      message: 'Ocorreu um erro inesperado. Tente novamente mais tarde.',
      details: [],
      requestId,
    }),
  };
}
