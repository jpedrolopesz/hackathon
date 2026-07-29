import 'server-only';
import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/web/auth/session';
import { getEnv } from '@/shared/config/env';
import { publicRequestUrl } from '@/web/auth/public-origin';

/**
 * Encerra a sessão local E a sessão do Hosted UI (`/logout` do Cognito) — só apagar
 * o cookie local deixaria a sessão do Cognito ativa; um login seguinte pularia
 * direto para o callback sem pedir credenciais de novo.
 */
export async function GET(request: Request): Promise<NextResponse> {
  await clearSessionCookie();

  const env = getEnv();
  const logoutUrl = new URL(`${env.COGNITO_HOSTED_UI_DOMAIN}/logout`);
  logoutUrl.searchParams.set('client_id', env.COGNITO_CLIENT_ID);
  logoutUrl.searchParams.set(
    'logout_uri',
    publicRequestUrl('/login', request, env.APP_PUBLIC_ORIGIN).toString(),
  );

  return NextResponse.redirect(logoutUrl);
}
