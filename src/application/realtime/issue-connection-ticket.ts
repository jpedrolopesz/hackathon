import { randomUUID } from 'node:crypto';
import type { ConnectionTicketRepository } from '@/application/ports/ConnectionTicketRepository';
import { CONNECTION_TICKET_TTL_SECONDS } from '@/application/realtime/realtime-limits';

export interface IssuedConnectionTicket {
  readonly connectionToken: string;
  readonly expiresAt: string;
}

/**
 * Compartilhado entre `JoinLiveUseCase` (primeira conexão) e
 * `IssueConnectionTicketUseCase` (reconexão do WebSocket — docs/fase-1-arquitetura.md,
 * seção 10.9) — ambos emitem o mesmo tipo de ticket, só diferem no que verificam
 * antes de emitir. Uso único, emitido de novo a cada chamada — nunca reaproveitado.
 */
export async function issueConnectionTicket(
  connectionTicketRepository: ConnectionTicketRepository,
  liveId: string,
  userId: string,
): Promise<IssuedConnectionTicket> {
  const ticket = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONNECTION_TICKET_TTL_SECONDS * 1000).toISOString();
  await connectionTicketRepository.create({
    ticket,
    liveId,
    userId,
    createdAt: now.toISOString(),
    expiresAt,
  });
  return { connectionToken: ticket, expiresAt };
}
