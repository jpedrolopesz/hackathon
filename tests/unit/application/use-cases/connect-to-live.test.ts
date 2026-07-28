import { describe, expect, it } from 'vitest';
import { ConnectToLiveUseCase } from '@/application/use-cases/connect-to-live';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { buildContext } from './fixtures';
import { FakeLiveParticipantRepository, FakeLiveSessionRepository } from './live-fixtures';
import { FakeAttendanceRepository, FakeWebSocketConnectionRepository } from './realtime-fixtures';

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
  const connectionRepository = new FakeWebSocketConnectionRepository();
  const attendanceRepository = new FakeAttendanceRepository();
  const useCase = new ConnectToLiveUseCase(
    liveSessionRepository,
    liveParticipantRepository,
    connectionRepository,
    attendanceRepository,
  );
  return {
    useCase,
    liveSessionRepository,
    liveParticipantRepository,
    connectionRepository,
    attendanceRepository,
  };
}

describe('ConnectToLiveUseCase', () => {
  it('rejects a user from another institution with a generic not-found (anti-enumeration)', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);

    await expect(
      useCase.execute(buildContext({ institutionId: 'institution-2' }), {
        liveId: 'live-1',
        connectionId: 'conn-1',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rejects a live that is not connectable yet (e.g. DRAFT)', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository, { status: 'DRAFT' });

    await expect(
      useCase.execute(buildContext(), { liveId: 'live-1', connectionId: 'conn-1' }),
    ).rejects.toMatchObject({ code: 'LIVE_NOT_AVAILABLE' });
  });

  it('rejects a user who has not joined the live yet (no LiveParticipant)', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);

    await expect(
      useCase.execute(buildContext(), { liveId: 'live-1', connectionId: 'conn-1' }),
    ).rejects.toMatchObject({ code: 'NOT_JOINED' });
  });

  it('saves the WebSocketConnection using the liveParticipantId from the existing LiveParticipant', async () => {
    const { useCase, liveSessionRepository, liveParticipantRepository, connectionRepository } =
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

    const connection = await useCase.execute(buildContext({ role: 'ALUNO' }), {
      liveId: 'live-1',
      connectionId: 'conn-1',
    });

    expect(connection.liveParticipantId).toBe('lp-1');
    expect(await connectionRepository.findByConnectionId('conn-1')).toEqual(connection);
  });

  it('marks attendance keyed by liveParticipantId (padrão #12), not connectionId', async () => {
    const { useCase, liveSessionRepository, liveParticipantRepository, attendanceRepository } =
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

    await useCase.execute(buildContext({ role: 'ALUNO' }), {
      liveId: 'live-1',
      connectionId: 'conn-1',
    });
    // Reconecta com um connectionId NOVO — mesmo liveParticipantId.
    await useCase.execute(buildContext({ role: 'ALUNO' }), {
      liveId: 'live-1',
      connectionId: 'conn-2',
    });

    const attendance = attendanceRepository.get('live-1', 'lp-1');
    expect(attendance).toBeDefined();
    expect(attendance?.joinedAt).toBeDefined();
  });
});
