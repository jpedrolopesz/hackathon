import { describe, expect, it } from 'vitest';
import { IssueConnectionTicketUseCase } from '@/application/use-cases/issue-connection-ticket';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { buildContext } from './fixtures';
import {
  FakeConnectionTicketRepository,
  FakeLiveParticipantRepository,
  FakeLiveSessionRepository,
} from './live-fixtures';

function seedLive(repo: FakeLiveSessionRepository, overrides: Partial<LiveSession> = {}): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2026-01-01T14:00:00.000Z',
    status: 'LIVE',
    stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(live);
  return live;
}

function makeUseCase() {
  const liveSessionRepository = new FakeLiveSessionRepository();
  const liveParticipantRepository = new FakeLiveParticipantRepository();
  const connectionTicketRepository = new FakeConnectionTicketRepository();
  const useCase = new IssueConnectionTicketUseCase(
    liveSessionRepository,
    liveParticipantRepository,
    connectionTicketRepository,
  );
  return { useCase, liveSessionRepository, liveParticipantRepository, connectionTicketRepository };
}

describe('IssueConnectionTicketUseCase', () => {
  it('rejects a user from another institution with a generic not-found (anti-enumeration)', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);

    await expect(
      useCase.execute(buildContext({ institutionId: 'institution-2' }), { liveId: 'live-1' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rejects a user who never joined (no LiveParticipant)', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);

    await expect(useCase.execute(buildContext(), { liveId: 'live-1' })).rejects.toMatchObject({
      code: 'NOT_JOINED',
    });
  });

  it('issues a fresh ticket for an already-joined user without touching IVS', async () => {
    const { useCase, liveSessionRepository, liveParticipantRepository, connectionTicketRepository } =
      makeUseCase();
    seedLive(liveSessionRepository);
    liveParticipantRepository.seed({
      liveParticipantId: 'lp-1',
      liveId: 'live-1',
      userId: 'user-1',
      role: 'ALUNO',
      capabilities: ['SUBSCRIBE'],
      joinedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await useCase.execute(buildContext(), { liveId: 'live-1' });

    expect(result.connectionToken).toBeDefined();
    expect(connectionTicketRepository.created[0]).toMatchObject({
      liveId: 'live-1',
      userId: 'user-1',
    });
  });

  it('issues a brand-new ticket on every call', async () => {
    const { useCase, liveSessionRepository, liveParticipantRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    liveParticipantRepository.seed({
      liveParticipantId: 'lp-1',
      liveId: 'live-1',
      userId: 'user-1',
      role: 'ALUNO',
      capabilities: ['SUBSCRIBE'],
      joinedAt: '2026-01-01T00:00:00.000Z',
    });

    const first = await useCase.execute(buildContext(), { liveId: 'live-1' });
    const second = await useCase.execute(buildContext(), { liveId: 'live-1' });

    expect(second.connectionToken).not.toBe(first.connectionToken);
  });
});
