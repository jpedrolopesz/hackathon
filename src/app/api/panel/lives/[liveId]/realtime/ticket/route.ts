import 'server-only';
import type { NextResponse } from 'next/server';
import { useCases } from '@/web/container';
import { handlePanelApiRequest } from '@/web/http/handle-panel-api-request';

/** Equivalente interno (sessão de cookie) de
 * `/api/v1/lives/{liveId}/realtime/ticket` — chamado pela reconexão preventiva do
 * WebSocket (jitter 1h45–1h55, docs/fase-1-arquitetura.md seção 10.9). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ liveId: string }> },
): Promise<NextResponse> {
  const { liveId } = await params;
  return handlePanelApiRequest((context) =>
    useCases.issueConnectionTicket.execute(context, { liveId }),
  );
}
