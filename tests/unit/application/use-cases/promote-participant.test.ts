import { describe, expect, it } from 'vitest';
import { PromoteParticipantUseCase } from '@/application/use-cases/promote-participant';
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

function seedSubscriberParticipant(repo: FakeLiveParticipantRepository): LiveParticipant {
  const participant: LiveParticipant = {
    liveParticipantId: 'participant-uuid',
    liveId: 'live-1',
    userId: 'student-1',
    role: 'ALUNO',
    capabilities: ['SUBSCRIBE'],
    ivsParticipantId: 'ivs-participant-1',
    joinedAt: '2026-01-01T00:00:00.000Z',
  };
  repo.seed(participant);
  return participant;
}

const context = buildContext({
  role: 'PROFESSOR',
  userId: 'teacher-1',
  institutionId: 'institution-1',
});

describe('PromoteParticipantUseCase', () => {
  it('reissues a token with explicit PUBLISH+SUBSCRIBE capabilities', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    seedSubscriberParticipant(liveParticipantRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new PromoteParticipantUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const result = await useCase.execute(context, {
      liveId: 'live-1',
      targetLiveParticipantId: 'participant-uuid',
    });

    expect(result.participant.capabilities).toEqual(['PUBLISH', 'SUBSCRIBE']);
    expect(result.participantToken).toBeDefined();
    expect(ivs.createParticipantTokenCalls[0]?.capabilities).toEqual(['PUBLISH', 'SUBSCRIBE']);
    expect(ivs.createParticipantTokenCalls[0]?.userId).toBe('participant-uuid');
  });

  it('is idempotent: promoting an already-presenter participant does not reissue a token', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    const participant = seedSubscriberParticipant(liveParticipantRepository);
    liveParticipantRepository.seed({ ...participant, capabilities: ['PUBLISH', 'SUBSCRIBE'] });
    const ivs = new FakeIvsRealTimeService();
    const useCase = new PromoteParticipantUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    const result = await useCase.execute(context, {
      liveId: 'live-1',
      targetLiveParticipantId: 'participant-uuid',
    });

    expect(result.participant.capabilities).toEqual(['PUBLISH', 'SUBSCRIBE']);
    expect(result.participantToken).toBeUndefined();
    expect(ivs.createParticipantTokenCalls).toHaveLength(0);
  });

  it('rejects a professor who does not own the class', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    seedSubscriberParticipant(liveParticipantRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new PromoteParticipantUseCase(
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

  it('raises NotFoundError for a participant who never joined the live', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    const liveParticipantRepository = new FakeLiveParticipantRepository();
    seedLive(liveSessionRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new PromoteParticipantUseCase(
      liveSessionRepository,
      liveParticipantRepository,
      ivs,
    );

    await expect(
      useCase.execute(context, { liveId: 'live-1', targetLiveParticipantId: 'never-joined' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
