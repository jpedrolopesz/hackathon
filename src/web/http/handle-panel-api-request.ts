import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { successResponse, toErrorResponseBody } from '@/shared/http';
import { getAuthenticatedContextForFetch } from '@/web/auth/context';

/**
 * Equivalente a `handleApiV1Request`, mas para rotas INTERNAS do painel chamadas via
 * `fetch()` do navegador (sessão de cookie, não Bearer JWT) — ex.: loop de refresh
 * de token do estúdio, reconexão do WebSocket. Estas rotas ficam sob `/api/panel/*`,
 * fora de `/api/v1/*` (que exige Bearer — o navegador não tem o access token em
 * JS), mas fazem sua PRÓPRIA verificação de sessão aqui dentro (nunca confiam em
 * `proxy.ts` sozinho, que só faz checagem otimista).
 */
export async function handlePanelApiRequest<T>(
  handler: (context: AuthenticatedRequestContext) => Promise<T>,
): Promise<NextResponse> {
  const requestId = randomUUID();

  try {
    const context = await getAuthenticatedContextForFetch();
    const data = await handler(context);
    return NextResponse.json(successResponse(data, requestId));
  } catch (error) {
    const { status, body } = toErrorResponseBody(error, requestId);
    return NextResponse.json(body, { status });
  }
}
