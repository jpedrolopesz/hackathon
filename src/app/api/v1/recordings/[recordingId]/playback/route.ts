import 'server-only';
import type { NextResponse } from 'next/server';
import { useCases } from '@/web/container';
import { handleApiV1Request } from '@/web/http/handle-api-v1-request';

/**
 * `GET /api/v1/recordings/{recordingId}/playback` — contrato para o app iOS (seção
 * 13 do README): devolve `manifestUrl` + os TRÊS valores do cookie assinado
 * (`policy`/`signature`/`keyPairId`) em JSON, não como `Set-Cookie` — um cliente
 * nativo grava esses valores no seu PRÓPRIO cookie store para o domínio da
 * distribuição (`URLSession`/`HTTPCookieStorage` no iOS; ver
 * docs/ios-integration.md), não depende do navegador. O painel web (que roda no
 * MESMO domínio) usa uma rota interna equivalente que já seta `Set-Cookie`
 * diretamente — ver `src/app/watch/[recordingId]/route.ts`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ recordingId: string }> },
): Promise<NextResponse> {
  const { recordingId } = await params;
  const appDomainName = new URL(request.url).host;
  return handleApiV1Request(request, (context) =>
    useCases.getRecordingPlayback.execute(context, { recordingId, appDomainName }),
  );
}
