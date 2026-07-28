import { describe, expect, it } from 'vitest';
import { HighlightQuestionUseCase } from '@/application/use-cases/highlight-question';
import type { Question } from '@/domain/entities/Question';
import {
  buildConnectionContext,
  FakeQuestionRepository,
  FakeRealtimeBroadcaster,
  FakeWebSocketConnectionRepository,
} from './realtime-fixtures';

function seedQuestion(repo: FakeQuestionRepository, overrides: Partial<Question> = {}): Question {
  const question: Question = {
    questionId: 'question-1',
    liveId: 'live-1',
    authorLiveParticipantId: 'participant-2',
    body: 'Por que isso funciona assim?',
    status: 'ANSWERED',
    createdAt: '2026-01-01T00:00:00.000Z',
    answeredAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  };
  repo.seed(question);
  return question;
}

function makeUseCase() {
  const questionRepository = new FakeQuestionRepository();
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const broadcaster = new FakeRealtimeBroadcaster();
  const useCase = new HighlightQuestionUseCase(
    questionRepository,
    connectionRepository,
    broadcaster,
  );
  return { useCase, questionRepository, broadcaster, connectionRepository };
}

describe('HighlightQuestionUseCase', () => {
  it('rejects a student', async () => {
    const { useCase, questionRepository } = makeUseCase();
    seedQuestion(questionRepository);

    await expect(
      useCase.execute(buildConnectionContext({ role: 'ALUNO' }), { questionId: 'question-1' }),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
  });

  it('highlights a question even if it was already answered', async () => {
    const { useCase, questionRepository, broadcaster, connectionRepository } = makeUseCase();
    seedQuestion(questionRepository);
    const connection = buildConnectionContext({ role: 'PROFESSOR' });
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: connection.liveId,
      userId: connection.userId,
      liveParticipantId: connection.liveParticipantId,
      role: connection.role,
      connectedAt: '2026-01-01T00:00:00.000Z',
    });

    const highlighted = await useCase.execute(connection, { questionId: 'question-1' });

    expect(highlighted.status).toBe('HIGHLIGHTED');
    expect(broadcaster.sentTo[0]?.payload).toMatchObject({ type: 'question.highlighted' });
  });
});
