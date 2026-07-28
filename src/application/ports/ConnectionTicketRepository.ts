import type { ConnectionTicket } from '@/domain/entities/ConnectionTicket';

export interface ConsumedConnectionTicket {
  readonly liveId: string;
  readonly userId: string;
}

export interface ConnectionTicketRepository {
  create(ticket: ConnectionTicket): Promise<void>;
  /**
   * Atômico: marca o ticket como consumido e retorna seus dados só na primeira
   * chamada bem-sucedida. Ticket inexistente, expirado ou já consumido (reuso)
   * retorna `null` — nunca lança — para o authorizer tratar tudo isso como
   * "Unauthorized" sem precisar distinguir a causa.
   */
  consume(ticket: string): Promise<ConsumedConnectionTicket | null>;
}
