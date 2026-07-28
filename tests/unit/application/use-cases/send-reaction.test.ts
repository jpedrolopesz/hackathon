import { describe, expect, it } from 'vitest';
import { SendReactionUseCase } from '@/application/use-cases/send-reaction';
import {
  buildConnectionContext,
  FakeRealtimeBroadcaster,
  FakeWebSocketConnectionRepository,
} from './realtime-fixtures';

function makeUseCase() {
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const broadcaster = new FakeRealtimeBroadcaster();
  const useCase = new SendReactionUseCase(connectionRepository, broadcaster);
  return { useCase, connectionRepository, broadcaster };
}

describe('SendReactionUseCase', () => {
  it('rejects an empty emoji', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext(), { emoji: '' }),
    ).rejects.toMatchObject({ code: 'REACTION_INVALID' });
  });

  it('rejects an emoji over the length limit', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext(), { emoji: 'a'.repeat(9) }),
    ).rejects.toMatchObject({ code: 'REACTION_INVALID' });
  });

  it('broadcasts and never persists anything (reactions are discard-only — frequency is throttled at API Gateway, not DynamoDB)', async () => {
    const { useCase, connectionRepository, broadcaster } = makeUseCase();
    const connection = buildConnectionContext();
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: connection.liveId,
      userId: connection.userId,
      liveParticipantId: connection.liveParticipantId,
      role: connection.role,
      connectedAt: '2026-01-01T00:00:00.000Z',
    });

    await useCase.execute(connection, { emoji: '👍' });

    expect(broadcaster.sentTo).toHaveLength(1);
    expect(broadcaster.sentTo[0]?.payload).toMatchObject({
      type: 'reaction.sent',
      data: { liveParticipantId: connection.liveParticipantId, emoji: '👍' },
    });
  });
});
