import 'server-only';
import type { NextResponse } from 'next/server';
import { useCases } from '@/web/container';
import { handleApiV1Request } from '@/web/http/handle-api-v1-request';

/**
 * `POST /api/v1/lives/{liveId}/token/refresh` — ponto de revisão explícito da Fase
 * 8: o participant token do IVS expira (180min, ver
 * `RefreshParticipantTokenUseCase`); o cliente do estúdio chama isto ANTES de
 * expirar para não cair a publicação no meio de uma aula longa.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ liveId: string }> },
): Promise<NextResponse> {
  const { liveId } = await params;
  return handleApiV1Request(request, (context) =>
    useCases.refreshParticipantToken.execute(context, { liveId }),
  );
}
