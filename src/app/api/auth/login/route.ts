import 'server-only';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getEnv } from '@/shared/config/env';
import { STATE_COOKIE_NAME } from '@/web/auth/oauth-state';
import { publicRequestUrl } from '@/web/auth/public-origin';

/**
 * Início do fluxo OAuth Authorization Code (Hosted UI do Cognito) — seção 13 do
 * README, fluxo de autenticação. `state` (CSRF do fluxo OAuth) fica num cookie
 * httpOnly de curta duração, comparado no callback; sem PKCE explícito — o client é
 * CONFIDENCIAL (troca o `code` por token no servidor, nunca no navegador), e `state`
 * já cobre o risco relevante aqui (interceptação de `code` por um site diferente);
 * PKCE existe principalmente para clients PÚBLICOS (SPA/mobile), que é o caso do
 * app iOS, não deste painel.
 */
export function GET(request: Request): NextResponse {
  const env = getEnv();
  const state = randomBytes(32).toString('base64url');
  const redirectUri = publicRequestUrl(
    '/api/auth/callback',
    request,
    env.APP_PUBLIC_ORIGIN,
  ).toString();

  const authorizeUrl = new URL(`${env.COGNITO_HOSTED_UI_DOMAIN}/oauth2/authorize`);
  authorizeUrl.searchParams.set('client_id', env.COGNITO_CLIENT_ID);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'openid email profile');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });
  return response;
}
