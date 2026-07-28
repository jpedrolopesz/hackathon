import 'server-only';
import { redirect } from 'next/navigation';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { UnauthorizedError } from '@/domain/errors/UnauthorizedError';
import { useCases } from '@/web/container';
import { getSession } from './session';

/**
 * Variante para rotas chamadas via `fetch()` do CLIENTE (não navegação de página) —
 * ex.: o loop de refresh de token do estúdio, o reconnect do WebSocket. Um
 * `redirect()` (usado por `getAuthenticatedContext`, abaixo) não faz sentido para
 * uma chamada `fetch`: o navegador só veria uma resposta redirecionada opaca, não
 * navegaria para `/login`. Lança `UnauthorizedError` (401 no envelope padrão) em vez
 * disso — o cliente JS decide o que fazer (ex.: forçar `location.href = '/login'`).
 */
export async function getAuthenticatedContextForFetch(): Promise<AuthenticatedRequestContext> {
  const session = await getSession();
  if (!session) {
    throw new UnauthorizedError('Sessão ausente ou expirada.', 'UNAUTHORIZED');
  }

  const profile = await useCases.getUserProfileBySub.execute(session.sub);
  if (!profile) {
    throw new UnauthorizedError('Perfil não provisionado.', 'UNAUTHORIZED');
  }

  return { userId: profile.userId, institutionId: profile.institutionId, role: profile.role };
}

/**
 * `role`/`institutionId` SEMPRE vêm do `UserProfile` no DynamoDB, nunca de um claim
 * do token do Cognito (docs/fase-1-arquitetura.md, seção 2 "Convergência") — o
 * `sub` da sessão só é a CHAVE para esse lookup, nunca a fonte da autorização em si.
 * Usado por Server Components/Actions do painel (sessão de cookie); rotas
 * `/api/v1/*` usam `resolveContextFromBearerToken` (Bearer JWT), não isto.
 */
export async function getAuthenticatedContext(): Promise<AuthenticatedRequestContext> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const profile = await useCases.getUserProfileBySub.execute(session.sub);
  if (!profile) {
    // Sessão válida no Cognito, mas sem UserProfile provisionado (ex.: ADMIN ainda
    // não cadastrou este professor) — sem isso não há institutionId/role para
    // autorizar nada. Tratado como não autenticado, não como um erro de autorização
    // detalhado.
    redirect('/login?error=PROFILE_NOT_PROVISIONED');
  }

  return { userId: profile.userId, institutionId: profile.institutionId, role: profile.role };
}
