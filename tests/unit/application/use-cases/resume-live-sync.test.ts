import { describe, expect, it } from 'vitest';
import { ResumeLiveSyncUseCase } from '@/application/use-cases/resume-live-sync';
import type { ChatMessage } from '@/domain/entities/ChatMessage';
import type { Poll } from '@/domain/entities/Poll';
import type { Question } from '@/domain/entities/Question';
import {
  buildConnectionContext,
  FakeChatMessageRepository,
  FakePollRepository,
  FakeQuestionRepository,
} from './realtime-fixtures';

function makeUseCase() {
  const chatMessageRepository = new FakeChatMessageRepository();
  const questionRepository = new FakeQuestionRepository();
  const pollRepository = new FakePollRepository();
  const useCase = new ResumeLiveSyncUseCase(
    chatMessageRepository,
    questionRepository,
    pollRepository,
  );
  return { useCase, chatMessageRepository, questionRepository, pollRepository };
}

describe('ResumeLiveSyncUseCase', () => {
  it('returns only chat messages created after `since`, oldest first', async () => {
    const { useCase, chatMessageRepository } = makeUseCase();
    const older: ChatMessage = {
      messageId: '0#01J000',
      liveId: 'live-1',
      shard: 0,
      authorLiveParticipantId: 'lp-1',
      authorRole: 'ALUNO',
      body: 'antes da lacuna',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const gapFirst: ChatMessage = { ...older, messageId: '0#01J001', createdAt: '2026-01-01T00:01:00.000Z', body: 'durante a lacuna 1' };
    const gapSecond: ChatMessage = { ...older, messageId: '0#01J002', createdAt: '2026-01-01T00:02:00.000Z', body: 'durante a lacuna 2' };
    await chatMessageRepository.save(older);
    await chatMessageRepository.save(gapSecond);
    await chatMessageRepository.save(gapFirst);

    const result = await useCase.execute(buildConnectionContext(), {
      since: '2026-01-01T00:00:30.000Z',
    });

    expect(result.chatMessages.map((m) => m.messageId)).toEqual(['0#01J001', '0#01J002']);
    expect(result.truncated).toBe(false);
    expect(result.oldestReturnedAt).toBe('2026-01-01T00:01:00.000Z');
  });

  it('never truncates in silence when there is nothing to report and no messages come back', async () => {
    const { useCase } = makeUseCase();

    const result = await useCase.execute(buildConnectionContext(), {
      since: '2026-01-01T00:00:00.000Z',
    });

    expect(result.chatMessages).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.oldestReturnedAt).toBeUndefined();
  });

  it('returns a full snapshot of questions and polls (not filtered by since)', async () => {
    const { useCase, questionRepository, pollRepository } = makeUseCase();
    const question: Question = {
      questionId: 'q-1',
      liveId: 'live-1',
      authorLiveParticipantId: 'lp-2',
      body: 'pergunta antiga, respondida durante a lacuna',
      status: 'ANSWERED',
      createdAt: '2020-01-01T00:00:00.000Z',
      answeredAt: '2026-01-01T00:01:30.000Z',
    };
    const poll: Poll = {
      pollId: 'p-1',
      liveId: 'live-1',
      question: 'Enquete antiga',
      options: [{ optionId: 'o-1', text: 'Sim' }],
      status: 'OPEN',
      createdAt: '2020-01-01T00:00:00.000Z',
    };
    questionRepository.seed(question);
    pollRepository.seed(poll);

    const result = await useCase.execute(buildConnectionContext(), {
      since: '2026-01-01T00:00:00.000Z',
    });

    expect(result.questions).toEqual([question]);
    expect(result.polls).toEqual([poll]);
  });
});
