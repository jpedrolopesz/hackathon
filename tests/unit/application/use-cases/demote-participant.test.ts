import { describe, expect, it } from 'vitest';
import { DemoteParticipantUseCase } from '@/application/use-cases/demote-participant';
import type { LiveParticipant } from '@/domain/entities/LiveParticipant';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { buildContext } from './fixtures';
import {
  FakeIvsRealTimeService,
  FakeLiveParticipantRepository,
  FakeLiveSessionRepository,
} from './live-fixtures';

function seedLive(repo: FakeLiveSessionRepository): LiveSession {
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
  };
  repo.seed(live);
  return live;
}

function seedPresenterParticipant(repo: FakeLiveParticipantRepository): LiveParticipant {
  const participant: LiveParticipant = {
    liveParticipantId: 'participant-uuid',
    liveId: 'live-1',
    userId: 'student-1',
    role: 'ALUNO',
    capabilities: ['PUBLISH', 'SUBSCRIBE'],
    ivsParticipantId: 'ivs-participant-1',
    joinedAt: '2026-01-01T00:00:00.000Z',
    promotedAt: '2026-01-01T00:05:00.000Z',
  };
  repo.seed(participant);
  return participant;
}

const context = buildContext({
  role: 'PROFESSOR',
  userId: 'teacher-1',
  institutionId: 'institution-1',
});

describe('DemoteParticipantUseCase — segurança: reemissão sozinha não basta (item 2)', () => {
  it('calls DisconnectParticipant to invalidate the active PUBLISH session — does not just reissue a token', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    seedPresenterParticipant(liveParticipantRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new DemoteParticipantUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const result = await useCase.execute(context, {
      liveId: 'live-1',
      targetLiveParticipantId: 'participant-uuid',
    });

    expect(ivs.disconnectParticipantCalls).toEqual([
      {
        stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage',
        ivsParticipantId: 'ivs-participant-1',
        reason: 'Rebaixado de apresentador',
      },
    ]);
    // Não reemite token — o cliente reconecta via join (ver docstring do use-case).
    expect(ivs.createParticipantTokenCalls).toHaveLength(0);
    expect(result.capabilities).toEqual(['SUBSCRIBE']);
  });

  it('is idempotent: demoting a participant who is not a presenter is a no-op, no DisconnectParticipant call', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    const participant = seedPresenterParticipant(liveParticipantRepository);
    liveParticipantRepository.seed({ ...participant, capabilities: ['SUBSCRIBE'] });
    const ivs = new FakeIvsRealTimeService();
    const useCase = new DemoteParticipantUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const result = await useCase.execute(context, {
      liveId: 'live-1',
      targetLiveParticipantId: 'participant-uuid',
    });

    expect(result.capabilities).toEqual(['SUBSCRIBE']);
    expect(ivs.disconnectParticipantCalls).toHaveLength(0);
  });

  it('rejects a professor who does not own the class', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    seedPresenterParticipant(liveParticipantRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new DemoteParticipantUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const outsider = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-2',
      institutionId: 'institution-1',
    });

    await expect(
      useCase.execute(outsider, { liveId: 'live-1', targetLiveParticipantId: 'participant-uuid' }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_OWNED' });
  });
});
