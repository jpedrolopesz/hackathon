import { describe, expect, it } from 'vitest';
import { RefreshParticipantTokenUseCase } from '@/application/use-cases/refresh-participant-token';
import type { LiveParticipant } from '@/domain/entities/LiveParticipant';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { buildContext } from './fixtures';
import {
  FakeIvsRealTimeService,
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

function seedParticipant(
  repo: FakeLiveParticipantRepository,
  overrides: Partial<LiveParticipant> = {},
): LiveParticipant {
  const participant: LiveParticipant = {
    liveParticipantId: 'participant-uuid',
    liveId: 'live-1',
    userId: 'student-1',
    role: 'ALUNO',
    capabilities: ['SUBSCRIBE'],
    ivsParticipantId: 'ivs-participant-1',
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(participant);
  return participant;
}

describe('RefreshParticipantTokenUseCase', () => {
  it('reissues a token with the SAME capabilities the participant already had (never elevates to PUBLISH)', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    seedParticipant(liveParticipantRepository, { userId: 'student-1', capabilities: ['SUBSCRIBE'] });
    const ivs = new FakeIvsRealTimeService();
    const useCase = new RefreshParticipantTokenUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });

    const result = await useCase.execute(context, { liveId: 'live-1' });

    expect(ivs.createParticipantTokenCalls).toHaveLength(1);
    expect(ivs.createParticipantTokenCalls[0]?.capabilities).toEqual(['SUBSCRIBE']);
    expect(result.participantToken).toBe('fake-token-1');
  });

  it('does not disconnect the participant (unlike DemoteParticipantUseCase)', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    seedParticipant(liveParticipantRepository, {
      userId: 'teacher-1',
      role: 'PROFESSOR',
      capabilities: ['PUBLISH', 'SUBSCRIBE'],
    });
    const ivs = new FakeIvsRealTimeService();
    const useCase = new RefreshParticipantTokenUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-1',
      institutionId: 'institution-1',
    });

    await useCase.execute(context, { liveId: 'live-1' });

    expect(ivs.disconnectParticipantCalls).toHaveLength(0);
  });

  it('rejects when the caller never joined this live', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new RefreshParticipantTokenUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const context = buildContext({
      role: 'ALUNO',
      userId: 'never-joined',
      institutionId: 'institution-1',
    });

    await expect(useCase.execute(context, { liveId: 'live-1' })).rejects.toMatchObject({
      code: 'NOT_JOINED',
    });
  });

  it('rejects a user from another institution with the anti-enumeration code', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new RefreshParticipantTokenUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-2',
    });

    await expect(useCase.execute(context, { liveId: 'live-1' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('rejects when the stage has not been provisioned yet', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    liveSessionRepository.seed({
      liveId: 'live-1',
      classId: 'class-1',
      institutionId: 'institution-1',
      teacherId: 'teacher-1',
      title: 'Aula 1',
      scheduledStartAt: '2026-01-01T14:00:00.000Z',
      status: 'SCHEDULED',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    seedParticipant(liveParticipantRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new RefreshParticipantTokenUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });

    await expect(useCase.execute(context, { liveId: 'live-1' })).rejects.toMatchObject({
      code: 'STAGE_NOT_PROVISIONED',
    });
  });
});
