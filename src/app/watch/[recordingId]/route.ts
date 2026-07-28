import 'server-only';
import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/errors/DomainError';
import { getAuthenticatedContext } from '@/web/auth/context';
import { useCases } from '@/web/container';

/**
 * Rota do PAINEL (sessão de cookie, não Bearer) equivalente a
 * `/api/v1/recordings/{id}/playback`, mas para o NAVEGADOR: seta os três cookies
 * assinados do CloudFront diretamente (`Set-Cookie`, `Secure`, `HttpOnly`,
 * `SameSite=Lax` — first-party desde a unificação de distribuição na Fase 7/ponto
 * de revisão) e redireciona para o manifesto — o player (`<video>`/hls.js) só
 * precisa navegar/carregar essa URL, os cookies já vão junto por serem do mesmo
 * domínio.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ recordingId: string }> },
): Promise<NextResponse> {
  const { recordingId } = await params;
  // `getAuthenticatedContext()` pode lançar um redirect (não capturado por
  // propósito — ver seção "Ponto de revisão" do doc oficial: `redirect()` deve
  // ficar FORA do try/catch em Route Handlers).
  const context = await getAuthenticatedContext();
  const appDomainName = new URL(request.url).host;

  let playback;
  try {
    playback = await useCases.getRecordingPlayback.execute(context, {
      recordingId,
      appDomainName,
    });
  } catch (error) {
    // Erro reage ao CODE, nunca ao texto (seção 13 do README) — a tela de
    // gravações (client component) lê `?watchError=<code>` e mostra a mensagem
    // PT-BR correspondente.
    const code = error instanceof DomainError ? error.code : 'INTERNAL_ERROR';
    return NextResponse.redirect(new URL(`/recordings?watchError=${code}`, request.url));
  }

  const response = NextResponse.redirect(playback.manifestUrl);
  const cookieOptions = {
    secure: true,
    httpOnly: true,
    sameSite: 'lax' as const,
    path: playback.cookiePath,
    expires: new Date(playback.expiresAt),
  };
  response.cookies.set('CloudFront-Policy', playback.cookies.policy, cookieOptions);
  response.cookies.set('CloudFront-Signature', playback.cookies.signature, cookieOptions);
  response.cookies.set('CloudFront-Key-Pair-Id', playback.cookies.keyPairId, cookieOptions);
  return response;
}
