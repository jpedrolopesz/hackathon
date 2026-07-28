import { describe, expect, it } from 'vitest';
import { DisconnectFromLiveUseCase } from '@/application/use-cases/disconnect-from-live';
import { FakeAttendanceRepository, FakeWebSocketConnectionRepository } from './realtime-fixtures';

describe('DisconnectFromLiveUseCase', () => {
  it('removes the connection by connectionId', async () => {
    const connectionRepository = new FakeWebSocketConnectionRepository();
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: 'live-1',
      userId: 'user-1',
      liveParticipantId: 'lp-1',
      role: 'ALUNO',
      connectedAt: '2026-01-01T00:00:00.000Z',
    });
    const useCase = new DisconnectFromLiveUseCase(connectionRepository, new FakeAttendanceRepository());

    await useCase.execute('conn-1');

    expect(await connectionRepository.findByConnectionId('conn-1')).toBeNull();
  });

  it('is a no-op (idempotent) when the connection does not exist', async () => {
    const connectionRepository = new FakeWebSocketConnectionRepository();
    const useCase = new DisconnectFromLiveUseCase(connectionRepository, new FakeAttendanceRepository());

    await expect(useCase.execute('unknown-conn')).resolves.toBeUndefined();
  });

  it('marks attendance leftAt for the connection liveParticipantId (padrão #12)', async () => {
    const connectionRepository = new FakeWebSocketConnectionRepository();
    connectionRepository.seed({
      connectionId: 'conn-1',
      liveId: 'live-1',
      userId: 'user-1',
      liveParticipantId: 'lp-1',
      role: 'ALUNO',
      connectedAt: '2026-01-01T00:00:00.000Z',
    });
    const attendanceRepository = new FakeAttendanceRepository();
    await attendanceRepository.markPresent('live-1', 'lp-1', 'user-1', '2026-01-01T00:00:00.000Z');
    const useCase = new DisconnectFromLiveUseCase(connectionRepository, attendanceRepository);

    await useCase.execute('conn-1');

    expect(attendanceRepository.get('live-1', 'lp-1')?.leftAt).toBeDefined();
  });
});
