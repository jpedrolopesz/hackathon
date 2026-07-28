import 'server-only';
import type { NextResponse } from 'next/server';
import { useCases } from '@/web/container';
import { handlePanelApiRequest } from '@/web/http/handle-panel-api-request';

/** Equivalente interno (sessão de cookie) de `/api/v1/lives/{liveId}/join`, usado
 * pelo estúdio do painel — ver nota em `handle-panel-api-request.ts`. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ liveId: string }> },
): Promise<NextResponse> {
  const { liveId } = await params;
  return handlePanelApiRequest((context) => useCases.joinLive.execute(context, { liveId }));
}
