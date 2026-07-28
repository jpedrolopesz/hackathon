import { describe, expect, it } from 'vitest';
import { SendChatMessageUseCase } from '@/application/use-cases/send-chat-message';
import { hashUserIdToShard } from '@/application/realtime/chat-shard';
import { CHAT_MESSAGE_MAX_LENGTH } from '@/application/realtime/realtime-limits';
import {
  buildConnectionContext,
  FakeChatMessageRepository,
  FakeRateLimiter,
  FakeRealtimeBroadcaster,
  FakeWebSocketConnectionRepository,
} from './realtime-fixtures';

const CHAT_SHARD_COUNT = 4;

function makeUseCase() {
  const chatMessageRepository = new FakeChatMessageRepository();
  const rateLimiter = new FakeRateLimiter();
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const broadcaster = new FakeRealtimeBroadcaster();
  const useCase = new SendChatMessageUseCase(
    chatMessageRepository,
    rateLimiter,
    connectionRepository,
    broadcaster,
    CHAT_SHARD_COUNT,
  );
  return { useCase, chatMessageRepository, rateLimiter, connectionRepository, broadcaster };
}

describe('SendChatMessageUseCase', () => {
  it('rejects an empty message', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext(), { body: '   ' }),
    ).rejects.toMatchObject({ code: 'MESSAGE_INVALID_LENGTH' });
  });

  it('rejects a message over the length limit', async () => {
    const { useCase } = makeUseCase();
    const body = 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1);
    await expect(useCase.execute(buildConnectionContext(), { body })).rejects.toMatchObject({
      code: 'MESSAGE_INVALID_LENGTH',
    });
  });

  it('rejects when the rate limiter denies the call', async () => {
    const { useCase, rateLimiter } = makeUseCase();
    const connection = buildConnectionContext();
    rateLimiter.denyNext(`CHAT#${connection.liveId}#${connection.userId}`);

    await expect(useCase.execute(connection, { body: 'oi' })).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('shards deterministically by userId, matching hashUserIdToShard', async () => {
    const { useCase, chatMessageRepository } = makeUseCase();
    const connection = buildConnectionContext({ userId: 'user-42' });

    const message = await useCase.execute(connection, { body: 'oi pessoal' });

    const expectedShard = hashUserIdToShard('user-42', CHAT_SHARD_COUNT);
    expect(message.shard).toBe(expectedShard);
    expect(message.messageId).toBe(`${expectedShard}#${message.messageId.split('#')[1]}`);
    expect(chatMessageRepository.saved).toEqual([message]);
  });

  it('broadcasts a chat.message.created envelope to the live', async () => {
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

    const message = await useCase.execute(connection, { body: 'oi pessoal' });

    expect(broadcaster.sentTo).toHaveLength(1);
    expect(broadcaster.sentTo[0]?.connectionId).toBe('conn-1');
    expect(broadcaster.sentTo[0]?.payload).toMatchObject({
      type: 'chat.message.created',
      liveId: connection.liveId,
      data: message,
    });
  });

  it('never persists the userId in the ChatMessage — only the opaque liveParticipantId', async () => {
    const { useCase, chatMessageRepository } = makeUseCase();
    const connection = buildConnectionContext({ userId: 'user-secret', liveParticipantId: 'lp-1' });

    await useCase.execute(connection, { body: 'oi' });

    expect(JSON.stringify(chatMessageRepository.saved[0])).not.toContain('user-secret');
    expect(chatMessageRepository.saved[0]?.authorLiveParticipantId).toBe('lp-1');
  });
});
