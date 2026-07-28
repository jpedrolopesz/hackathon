import { describe, expect, it } from 'vitest';
import { AnswerQuestionUseCase } from '@/application/use-cases/answer-question';
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
    status: 'OPEN',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(question);
  return question;
}

function makeUseCase() {
  const questionRepository = new FakeQuestionRepository();
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const broadcaster = new FakeRealtimeBroadcaster();
  const useCase = new AnswerQuestionUseCase(questionRepository, connectionRepository, broadcaster);
  return { useCase, questionRepository, broadcaster, connectionRepository };
}

describe('AnswerQuestionUseCase', () => {
  it('rejects a student', async () => {
    const { useCase, questionRepository } = makeUseCase();
    seedQuestion(questionRepository);

    await expect(
      useCase.execute(buildConnectionContext({ role: 'ALUNO' }), { questionId: 'question-1' }),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
  });

  it('rejects an unknown question', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext({ role: 'PROFESSOR' }), { questionId: 'missing' }),
    ).rejects.toMatchObject({ code: 'QUESTION_NOT_FOUND' });
  });

  it('marks the question ANSWERED, stamps answeredAt and broadcasts question.answered', async () => {
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

    const answered = await useCase.execute(connection, { questionId: 'question-1' });

    expect(answered.status).toBe('ANSWERED');
    expect(answered.answeredAt).toBeDefined();
    expect((await questionRepository.find('live-1', 'question-1'))?.status).toBe('ANSWERED');
    expect(broadcaster.sentTo[0]?.payload).toMatchObject({ type: 'question.answered' });
  });
});
