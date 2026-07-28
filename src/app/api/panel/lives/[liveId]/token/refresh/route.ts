import 'server-only';
import type { NextResponse } from 'next/server';
import { useCases } from '@/web/container';
import { handlePanelApiRequest } from '@/web/http/handle-panel-api-request';

/** Equivalente interno (sessão de cookie) de `/api/v1/lives/{liveId}/token/refresh`
 * — chamado pelo loop de refresh do estúdio (ver `src/web/studio/`). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ liveId: string }> },
): Promise<NextResponse> {
  const { liveId } = await params;
  return handlePanelApiRequest((context) =>
    useCases.refreshParticipantToken.execute(context, { liveId }),
  );
}
