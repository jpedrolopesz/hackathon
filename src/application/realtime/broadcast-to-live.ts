import type { RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import type { RealtimeEnvelope } from '@/domain/value-objects/RealtimeEnvelope';

/**
 * Padrão de acesso #11 (docs/fase-1-arquitetura.md, seção 10.5): lista as conexões da
 * live com `ConsistentRead: true` — quem acabou de conectar não pode ficar de fora.
 * Conexões que respondem `stale` (a aba fechou sem `$disconnect`) são removidas aqui
 * mesmo, best-effort — evita esperar o TTL de 2h para parar de tentar falar com um
 * cliente morto nos próximos broadcasts.
 */
export async function broadcastToLive<T>(
  connectionRepository: WebSocketConnectionRepository,
  broadcaster: RealtimeBroadcaster,
  liveId: string,
  envelope: RealtimeEnvelope<T>,
): Promise<void> {
  const connections = await connectionRepository.listByLive(liveId);

  await Promise.all(
    connections.map(async (connection) => {
      const result = await broadcaster.send(connection.connectionId, envelope);
      if (result === 'stale') {
        await connectionRepository.removeByConnectionId(connection.connectionId);
      }
    }),
  );
}
