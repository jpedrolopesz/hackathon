import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { successResponse, toErrorResponseBody } from '@/shared/http';
import { resolveContextFromBearerToken } from '@/web/auth/bearer-context';

/**
 * Wrapper comum das rotas `/api/v1/*` (contrato do app iOS — seção 13 do README):
 * resolve o Bearer token, chama o handler, e traduz qualquer `DomainError` para o
 * envelope padrão (`toErrorResponseBody`, já usado por outras superfícies). Loading/
 * erro no CLIENTE (painel/iOS) deve reagir ao `code` deste envelope, nunca ao texto
 * de `message` (seção 13 do README, ponto de revisão da Fase 8).
 */
export async function handleApiV1Request<T>(
  request: Request,
  handler: (context: AuthenticatedRequestContext) => Promise<T>,
): Promise<NextResponse> {
  const requestId = randomUUID();

  try {
    const context = await resolveContextFromBearerToken(request);
    const data = await handler(context);
    return NextResponse.json(successResponse(data, requestId));
  } catch (error) {
    const { status, body } = toErrorResponseBody(error, requestId);
    return NextResponse.json(body, { status });
  }
}
