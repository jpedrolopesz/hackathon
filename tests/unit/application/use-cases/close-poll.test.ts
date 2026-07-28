import { describe, expect, it } from 'vitest';
import { ClosePollUseCase } from '@/application/use-cases/close-poll';
import { VoteInPollUseCase } from '@/application/use-cases/vote-in-poll';
import type { Poll } from '@/domain/entities/Poll';
import {
  buildConnectionContext,
  FakePollRepository,
  FakeRateLimiter,
  FakeRealtimeBroadcaster,
  FakeWebSocketConnectionRepository,
} from './realtime-fixtures';

function seedPoll(repo: FakePollRepository, overrides: Partial<Poll> = {}): Poll {
  const poll: Poll = {
    pollId: 'poll-1',
    liveId: 'live-1',
    question: 'Gostou da aula?',
    options: [
      { optionId: 'opt-yes', text: 'Sim' },
      { optionId: 'opt-no', text: 'Não' },
    ],
    status: 'OPEN',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(poll);
  return poll;
}

function makeUseCase() {
  const pollRepository = new FakePollRepository();
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const broadcaster = new FakeRealtimeBroadcaster();
  const useCase = new ClosePollUseCase(pollRepository, connectionRepository, broadcaster);
  return { useCase, pollRepository, connectionRepository, broadcaster };
}

describe('ClosePollUseCase', () => {
  it('rejects a student', async () => {
    const { useCase, pollRepository } = makeUseCase();
    seedPoll(pollRepository);

    await expect(
      useCase.execute(buildConnectionContext({ role: 'ALUNO' }), { pollId: 'poll-1' }),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
  });

  it('rejects an unknown poll', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext({ role: 'PROFESSOR' }), { pollId: 'missing' }),
    ).rejects.toMatchObject({ code: 'POLL_NOT_FOUND' });
  });

  it('closes the poll and tallies votes correctly per option', async () => {
    const { useCase, pollRepository, connectionRepository, broadcaster } = makeUseCase();
    seedPoll(pollRepository);
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: 'live-1',
      userId: 'user-1',
      liveParticipantId: 'lp-1',
      role: 'PROFESSOR',
      connectedAt: '2026-01-01T00:00:00.000Z',
    });
    const voteUseCase = new VoteInPollUseCase(
      pollRepository,
      new FakeRateLimiter(),
      connectionRepository,
      new FakeRealtimeBroadcaster(),
    );
    await voteUseCase.execute(buildConnectionContext({ liveParticipantId: 'lp-1' }), {
      pollId: 'poll-1',
      optionId: 'opt-yes',
    });
    await voteUseCase.execute(
      buildConnectionContext({ userId: 'user-2', liveParticipantId: 'lp-2' }),
      { pollId: 'poll-1', optionId: 'opt-yes' },
    );
    await voteUseCase.execute(
      buildConnectionContext({ userId: 'user-3', liveParticipantId: 'lp-3' }),
      { pollId: 'poll-1', optionId: 'opt-no' },
    );

    const result = await useCase.execute(buildConnectionContext({ role: 'PROFESSOR' }), {
      pollId: 'poll-1',
    });

    expect(result.poll.status).toBe('CLOSED');
    expect(result.poll.closedAt).toBeDefined();
    expect(result.results).toEqual(
      expect.arrayContaining([
        { optionId: 'opt-yes', count: 2 },
        { optionId: 'opt-no', count: 1 },
      ]),
    );
    expect(broadcaster.sentTo[0]?.payload).toMatchObject({ type: 'poll.closed' });
  });

  it('is idempotent — closing an already-closed poll recomputes and rebroadcasts instead of erroring', async () => {
    const { useCase, pollRepository, broadcaster, connectionRepository } = makeUseCase();
    seedPoll(pollRepository, { status: 'CLOSED', closedAt: '2026-01-01T01:00:00.000Z' });
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: 'live-1',
      userId: 'user-1',
      liveParticipantId: 'lp-1',
      role: 'PROFESSOR',
      connectedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await useCase.execute(buildConnectionContext({ role: 'PROFESSOR' }), {
      pollId: 'poll-1',
    });

    expect(result.poll.status).toBe('CLOSED');
    expect(result.poll.closedAt).toBe('2026-01-01T01:00:00.000Z');
    expect(broadcaster.sentTo).toHaveLength(1);
  });
});
