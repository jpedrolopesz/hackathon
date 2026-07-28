import { describe, expect, it } from 'vitest';
import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';
import {
  FakeRealtimeBroadcaster,
  FakeWebSocketConnectionRepository,
} from '../use-cases/realtime-fixtures';

describe('broadcastToLive', () => {
  it('sends to every connection in the live', async () => {
    const connectionRepository = new FakeWebSocketConnectionRepository();
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: 'live-1',
      userId: 'user-1',
      liveParticipantId: 'lp-1',
      role: 'ALUNO',
      connectedAt: '2026-01-01T00:00:00.000Z',
    });
    connectionRepository.seed({
      connectionId: 'conn-2',
      liveId: 'live-1',
      userId: 'user-2',
      liveParticipantId: 'lp-2',
      role: 'ALUNO',
      connectedAt: '2026-01-01T00:00:00.000Z',
    });
    // Conexão de outra live não deve receber o broadcast.
    connectionRepository.seed({
      connectionId: 'conn-other-live',
      liveId: 'live-2',
      userId: 'user-3',
      liveParticipantId: 'lp-3',
      role: 'ALUNO',
      connectedAt: '2026-01-01T00:00:00.000Z',
    });
    const broadcaster = new FakeRealtimeBroadcaster();

    await broadcastToLive(
      connectionRepository,
      broadcaster,
      'live-1',
      buildEnvelope('chat.message.created', 'live-1', { hello: 'world' }),
    );

    const sentConnectionIds = broadcaster.sentTo.map((call) => call.connectionId).sort();
    expect(sentConnectionIds).toEqual(['conn-1', 'conn-2']);
  });

  it('removes connections that come back stale from the broadcaster', async () => {
    const connectionRepository = new FakeWebSocketConnectionRepository();
    connectionRepository.seed({
      connectionId: 'conn-dead',
      liveId: 'live-1',
      userId: 'user-1',
      liveParticipantId: 'lp-1',
      role: 'ALUNO',
      connectedAt: '2026-01-01T00:00:00.000Z',
    });
    const broadcaster = new FakeRealtimeBroadcaster();
    broadcaster.staleConnectionIds.add('conn-dead');

    await broadcastToLive(
      connectionRepository,
      broadcaster,
      'live-1',
      buildEnvelope('chat.message.created', 'live-1', {}),
    );

    expect(await connectionRepository.findByConnectionId('conn-dead')).toBeNull();
  });
});
