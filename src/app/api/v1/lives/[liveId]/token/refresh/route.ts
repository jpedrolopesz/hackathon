import 'server-only';
import type { NextResponse } from 'next/server';
import { useCases } from '@/web/container';
import { handleApiV1Request } from '@/web/http/handle-api-v1-request';

/**
 * `POST /api/v1/lives/{liveId}/token/refresh` — ponto de revisão explícito da Fase
 * 8: fallback para uma aula que ultrapassou a duração agendada + margem. O cliente
 * chama isto antes de expirar e reconecta brevemente o Stage.
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
