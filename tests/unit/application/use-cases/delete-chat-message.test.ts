import { describe, expect, it } from 'vitest';
import { DeleteChatMessageUseCase } from '@/application/use-cases/delete-chat-message';
import {
  buildConnectionContext,
  FakeChatMessageRepository,
  FakeRealtimeBroadcaster,
  FakeWebSocketConnectionRepository,
} from './realtime-fixtures';

function makeUseCase() {
  const chatMessageRepository = new FakeChatMessageRepository();
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const broadcaster = new FakeRealtimeBroadcaster();
  const useCase = new DeleteChatMessageUseCase(
    chatMessageRepository,
    connectionRepository,
    broadcaster,
  );
  return { useCase, chatMessageRepository, broadcaster };
}

describe('DeleteChatMessageUseCase', () => {
  it('rejects a student (moderation is professor/admin only)', async () => {
    const { useCase } = makeUseCase();
    const connection = buildConnectionContext({ role: 'ALUNO' });

    await expect(
      useCase.execute(connection, { messageId: '0#01J000' }),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
  });

  it('allows a professor to delete and broadcasts chat.message.deleted', async () => {
    const { useCase, chatMessageRepository, broadcaster } = makeUseCase();
    const connection = buildConnectionContext({ role: 'PROFESSOR' });

    await useCase.execute(connection, { messageId: '0#01J000' });

    expect(chatMessageRepository.deleted).toEqual([
      { liveId: connection.liveId, messageId: '0#01J000' },
    ]);
    expect(broadcaster.sentTo).toHaveLength(0); // no connections registered in this test
  });

  it('allows an admin to delete', async () => {
    const { useCase, chatMessageRepository } = makeUseCase();
    const connection = buildConnectionContext({ role: 'ADMIN' });

    await useCase.execute(connection, { messageId: '1#01J111' });

    expect(chatMessageRepository.deleted).toHaveLength(1);
  });
});
