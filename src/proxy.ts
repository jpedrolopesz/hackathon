import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/web/auth/session';

/**
 * Antes chamado `middleware.ts` — a partir do Next.js 16 o convention file é
 * `proxy.ts` (`middleware` foi renomeado para "Proxy"; ver
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md, confirmado
 * antes de escrever este arquivo, por causa do aviso em AGENTS.md sobre este não
 * ser o Next.js "de treino"). `middleware.ts` NÃO seria reconhecido nesta versão.
 *
 * **Ponto de revisão (Fase 8) — runtime Node, não Edge.** A validação de sessão
 * (`aws-jwt-verify`/Secrets Manager) precisa de APIs de Node. Na doc oficial:
 * "Proxy defaults to using the Node.js runtime. The `runtime` config option is not
 * available in Proxy files. Setting the `runtime` config option in Proxy will throw
 * an error" (mesmo arquivo acima, seção "Runtime") — ou seja, não há Edge Runtime
 * para configurar/desconfigurar aqui: Proxy roda em Node por padrão nesta versão do
 * Next, sem opção de mudar. Confirma o requisito sem precisar de config nenhuma.
 *
 * Checagem OTIMISTA (só decripta o cookie — nunca consulta o UserProfile aqui, ver
 * `getAuthenticatedContext`): decide redirecionar para `/login` ou não. A
 * verificação de verdade (autorização por recurso) acontece nos Server
 * Components/Actions/Route Handlers, nunca só aqui — Proxy não é uma solução
 * completa de sessão (mesmo aviso da doc oficial de autenticação do Next).
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSessionCookie) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // JWT authorizer só em /api/v1/*; as demais rotas de /api (auth) precisam ficar
    // acessíveis SEM sessão (é o próprio fluxo que cria a sessão). /login idem, ou
    // ninguém conseguiria chegar ao login. _next/static e _next/image nunca passam
    // por checagem de sessão (ver seção do próprio doc: matcher evita bloquear
    // assets).
    '/((?!api|login|_next/static|_next/image|favicon.ico).*)',
  ],
};
