import { describe, expect, it } from 'vitest';
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
  const rateLimiter = new FakeRateLimiter();
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const broadcaster = new FakeRealtimeBroadcaster();
  const useCase = new VoteInPollUseCase(
    pollRepository,
    rateLimiter,
    connectionRepository,
    broadcaster,
  );
  return { useCase, pollRepository, rateLimiter, broadcaster, connectionRepository };
}

describe('VoteInPollUseCase', () => {
  it('rejects an unknown poll', async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.execute(buildConnectionContext(), { pollId: 'missing', optionId: 'opt-yes' }),
    ).rejects.toMatchObject({ code: 'POLL_NOT_FOUND' });
  });

  it('rejects voting on a closed poll', async () => {
    const { useCase, pollRepository } = makeUseCase();
    seedPoll(pollRepository, { status: 'CLOSED', closedAt: '2026-01-01T01:00:00.000Z' });

    await expect(
      useCase.execute(buildConnectionContext(), { pollId: 'poll-1', optionId: 'opt-yes' }),
    ).rejects.toMatchObject({ code: 'POLL_CLOSED' });
  });

  it('rejects an option that does not belong to the poll', async () => {
    const { useCase, pollRepository } = makeUseCase();
    seedPoll(pollRepository);

    await expect(
      useCase.execute(buildConnectionContext(), { pollId: 'poll-1', optionId: 'opt-invalid' }),
    ).rejects.toMatchObject({ code: 'POLL_OPTION_NOT_FOUND' });
  });

  it('rejects when rate limited', async () => {
    const { useCase, pollRepository, rateLimiter } = makeUseCase();
    seedPoll(pollRepository);
    const connection = buildConnectionContext();
    rateLimiter.denyNext(`POLLVOTE#${connection.liveId}#${connection.userId}`);

    await expect(
      useCase.execute(connection, { pollId: 'poll-1', optionId: 'opt-yes' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
  });

  it('records the vote and broadcasts poll.vote.recorded', async () => {
    const { useCase, pollRepository, broadcaster, connectionRepository } = makeUseCase();
    seedPoll(pollRepository);
    const connection = buildConnectionContext({ liveParticipantId: 'lp-1' });
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: connection.liveId,
      userId: connection.userId,
      liveParticipantId: connection.liveParticipantId,
      role: connection.role,
      connectedAt: '2026-01-01T00:00:00.000Z',
    });

    await useCase.execute(connection, { pollId: 'poll-1', optionId: 'opt-yes' });

    const votes = await pollRepository.listVotes('live-1', 'poll-1');
    expect(votes).toEqual([
      expect.objectContaining({ liveParticipantId: 'lp-1', optionId: 'opt-yes' }),
    ]);
    expect(broadcaster.sentTo[0]?.payload).toMatchObject({
      type: 'poll.vote.recorded',
      data: { pollId: 'poll-1', optionId: 'opt-yes', liveParticipantId: 'lp-1' },
    });
  });

  it('changes the vote instead of double-counting when voting again', async () => {
    const { useCase, pollRepository } = makeUseCase();
    seedPoll(pollRepository);
    const connection = buildConnectionContext({ liveParticipantId: 'lp-1' });

    await useCase.execute(connection, { pollId: 'poll-1', optionId: 'opt-yes' });
    await useCase.execute(connection, { pollId: 'poll-1', optionId: 'opt-no' });

    const votes = await pollRepository.listVotes('live-1', 'poll-1');
    expect(votes).toHaveLength(1);
    expect(votes[0]?.optionId).toBe('opt-no');
  });
});
