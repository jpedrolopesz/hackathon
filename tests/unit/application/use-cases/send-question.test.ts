import { describe, expect, it } from 'vitest';
import { SendQuestionUseCase } from '@/application/use-cases/send-question';
import {
  buildConnectionContext,
  FakeQuestionRepository,
  FakeRateLimiter,
  FakeRealtimeBroadcaster,
  FakeWebSocketConnectionRepository,
} from './realtime-fixtures';

function makeUseCase() {
  const questionRepository = new FakeQuestionRepository();
  const rateLimiter = new FakeRateLimiter();
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const broadcaster = new FakeRealtimeBroadcaster();
  const useCase = new SendQuestionUseCase(
    questionRepository,
    rateLimiter,
    connectionRepository,
    broadcaster,
  );
  return { useCase, questionRepository, rateLimiter, broadcaster, connectionRepository };
}

describe('SendQuestionUseCase', () => {
  it('rejects an empty question', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext(), { body: '' }),
    ).rejects.toMatchObject({ code: 'MESSAGE_INVALID_LENGTH' });
  });

  it('rejects when rate limited', async () => {
    const { useCase, rateLimiter } = makeUseCase();
    const connection = buildConnectionContext();
    rateLimiter.denyNext(`QUESTION#${connection.liveId}#${connection.userId}`);

    await expect(useCase.execute(connection, { body: 'Por que?' })).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('creates the question as OPEN, saves it and broadcasts question.created', async () => {
    const { useCase, questionRepository, broadcaster, connectionRepository } = makeUseCase();
    const connection = buildConnectionContext();
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: connection.liveId,
      userId: connection.userId,
      liveParticipantId: connection.liveParticipantId,
      role: connection.role,
      connectedAt: '2026-01-01T00:00:00.000Z',
    });

    const question = await useCase.execute(connection, { body: 'Por que isso funciona assim?' });

    expect(question.status).toBe('OPEN');
    expect(question.authorLiveParticipantId).toBe(connection.liveParticipantId);
    expect(await questionRepository.find(connection.liveId, question.questionId)).toEqual(
      question,
    );
    expect(broadcaster.sentTo[0]?.payload).toMatchObject({
      type: 'question.created',
      data: question,
    });
  });
});
