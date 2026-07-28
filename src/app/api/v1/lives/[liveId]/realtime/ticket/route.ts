import 'server-only';
import type { NextResponse } from 'next/server';
import { useCases } from '@/web/container';
import { handleApiV1Request } from '@/web/http/handle-api-v1-request';

/**
 * `POST /api/v1/lives/{liveId}/realtime/ticket` — reemite o connectionToken do
 * WebSocket para reconexão (docs/fase-1-arquitetura.md, seção 10.9). Não chama a
 * API do IVS nem grava `LiveParticipant` — ver `IssueConnectionTicketUseCase`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ liveId: string }> },
): Promise<NextResponse> {
  const { liveId } = await params;
  return handleApiV1Request(request, (context) =>
    useCases.issueConnectionTicket.execute(context, { liveId }),
  );
}
