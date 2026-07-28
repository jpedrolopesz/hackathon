import { describe, expect, it } from 'vitest';
import { CreatePollUseCase } from '@/application/use-cases/create-poll';
import {
  buildConnectionContext,
  FakePollRepository,
  FakeRealtimeBroadcaster,
  FakeWebSocketConnectionRepository,
} from './realtime-fixtures';

function makeUseCase() {
  const pollRepository = new FakePollRepository();
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const broadcaster = new FakeRealtimeBroadcaster();
  const useCase = new CreatePollUseCase(pollRepository, connectionRepository, broadcaster);
  return { useCase, pollRepository, broadcaster, connectionRepository };
}

describe('CreatePollUseCase', () => {
  it('rejects a student', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext({ role: 'ALUNO' }), {
        question: 'Gostou da aula?',
        options: ['Sim', 'Não'],
      }),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
  });

  it('rejects fewer than 2 options', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext({ role: 'PROFESSOR' }), {
        question: 'Gostou da aula?',
        options: ['Sim'],
      }),
    ).rejects.toMatchObject({ code: 'POLL_OPTIONS_INVALID_COUNT' });
  });

  it('rejects an empty option', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext({ role: 'PROFESSOR' }), {
        question: 'Gostou da aula?',
        options: ['Sim', '  '],
      }),
    ).rejects.toMatchObject({ code: 'POLL_OPTION_INVALID_LENGTH' });
  });

  it('creates the poll OPEN with denormalized options and broadcasts poll.created', async () => {
    const { useCase, pollRepository, broadcaster, connectionRepository } = makeUseCase();
    const connection = buildConnectionContext({ role: 'PROFESSOR' });
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: connection.liveId,
      userId: connection.userId,
      liveParticipantId: connection.liveParticipantId,
      role: connection.role,
      connectedAt: '2026-01-01T00:00:00.000Z',
    });

    const poll = await useCase.execute(connection, {
      question: 'Gostou da aula?',
      options: ['Sim', 'Não'],
    });

    expect(poll.status).toBe('OPEN');
    expect(poll.options.map((option) => option.text)).toEqual(['Sim', 'Não']);
    expect(await pollRepository.find('live-1', poll.pollId)).toEqual(poll);
    expect(broadcaster.sentTo[0]?.payload).toMatchObject({ type: 'poll.created', data: poll });
  });
});
