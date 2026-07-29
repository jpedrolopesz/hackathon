import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getPanelClientSecret } from '@/infrastructure/aws/cognito/get-panel-client-secret';
import { setSessionCookie } from '@/web/auth/session';
import { getEnv } from '@/shared/config/env';
import { STATE_COOKIE_NAME } from '@/web/auth/oauth-state';
import { publicRequestUrl } from '@/web/auth/public-origin';

interface TokenResponse {
  readonly access_token: string;
  readonly id_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

interface IdTokenClaims {
  readonly sub: string;
}

function decodeIdTokenSub(idToken: string): string {
  // O `id_token` já foi emitido pelo PRÓPRIO Cognito nesta troca de código
  // server-to-server (autenticada com o client secret, sobre TLS) — decodificar sem
  // reverificar assinatura aqui é seguro porque a origem é confiável por construção,
  // diferente de aceitar um JWT vindo de fora (é para ISSO que `bearer-context.ts`
  // usa `CognitoJwtVerifier`, que SEMPRE reverifica).
  const payloadSegment = idToken.split('.')[1];
  if (!payloadSegment) {
    throw new Error('id_token malformado.');
  }
  const claims = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf-8')) as IdTokenClaims;
  return claims.sub;
}

/**
 * Troca o `code` do OAuth por tokens — SEMPRE no servidor (BFF), nunca no
 * navegador. `Authorization: Basic` com o client secret é exigido porque o painel é
 * um client CONFIDENCIAL (seção 13 do README, ponto de revisão em
 * `infrastructure/stacks/cognito-stack.ts`).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const env = getEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE_NAME)?.value;
  cookieStore.delete(STATE_COOKIE_NAME);

  if (error) {
    return NextResponse.redirect(
      publicRequestUrl(
        `/login?error=${encodeURIComponent(error)}`,
        request,
        env.APP_PUBLIC_ORIGIN,
      ),
    );
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      publicRequestUrl('/login?error=INVALID_OAUTH_STATE', request, env.APP_PUBLIC_ORIGIN),
    );
  }

  const clientSecret = await getPanelClientSecret(env.COGNITO_USER_POOL_ID, env.COGNITO_CLIENT_ID);
  const redirectUri = publicRequestUrl(
    '/api/auth/callback',
    request,
    env.APP_PUBLIC_ORIGIN,
  ).toString();
  const basicAuth = Buffer.from(`${env.COGNITO_CLIENT_ID}:${clientSecret}`).toString('base64');

  const tokenResponse = await fetch(`${env.COGNITO_HOSTED_UI_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.COGNITO_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(
      publicRequestUrl('/login?error=TOKEN_EXCHANGE_FAILED', request, env.APP_PUBLIC_ORIGIN),
    );
  }

  const tokens = (await tokenResponse.json()) as TokenResponse;
  const sub = decodeIdTokenSub(tokens.id_token);

  await setSessionCookie({
    sub,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
  });

  return NextResponse.redirect(publicRequestUrl('/lives', request, env.APP_PUBLIC_ORIGIN));
}
