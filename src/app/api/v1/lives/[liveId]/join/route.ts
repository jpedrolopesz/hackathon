import 'server-only';
import type { NextResponse } from 'next/server';
import { useCases } from '@/web/container';
import { handleApiV1Request } from '@/web/http/handle-api-v1-request';

/**
 * `POST /api/v1/lives/{liveId}/join` — "entrar no estúdio"/"entrar na aula" (seção
 * 13 do README). Devolve o participant token do IVS (Web Broadcast SDK) e o
 * connectionToken do WebSocket (ver `docs/openapi.yaml`).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ liveId: string }> },
): Promise<NextResponse> {
  const { liveId } = await params;
  return handleApiV1Request(request, (context) => useCases.joinLive.execute(context, { liveId }));
}
