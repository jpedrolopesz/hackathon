import { describe, expect, it } from 'vitest';
import { StartLiveUseCase } from '@/application/use-cases/start-live';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { LiveStatus } from '@/domain/value-objects/LiveStatus';
import { buildContext } from './fixtures';
import { FakeLiveSessionRepository } from './live-fixtures';

function seedWaitingLiveWithStage(repo: FakeLiveSessionRepository, status: LiveStatus = 'WAITING'): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2099-01-01T14:00:00.000Z',
    status,
    stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  repo.seed(live);
  return live;
}

function seedScheduledLiveWithoutStage(repo: FakeLiveSessionRepository): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2099-01-01T14:00:00.000Z',
    status: 'SCHEDULED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  repo.seed(live);
  return live;
}

const context = buildContext({ role: 'PROFESSOR', userId: 'teacher-1', institutionId: 'institution-1' });

describe('StartLiveUseCase — sem chamada de API IVS (Stage já existe, provisionado antes)', () => {
  it('transitions WAITING -> LIVE', async () => {
    const repo = new FakeLiveSessionRepository();
    seedWaitingLiveWithStage(repo);
    const useCase = new StartLiveUseCase(repo);

    const result = await useCase.execute(context, 'live-1');

    expect(result.status).toBe('LIVE');
  });

  it('is idempotent: starting an already-LIVE live is a no-op success', async () => {
    const repo = new FakeLiveSessionRepository();
    seedWaitingLiveWithStage(repo, 'LIVE');
    const useCase = new StartLiveUseCase(repo);

    const result = await useCase.execute(context, 'live-1');

    expect(result.status).toBe('LIVE');
  });

  it('refuses to start a live with no stage provisioned yet', async () => {
    const repo = new FakeLiveSessionRepository();
    seedScheduledLiveWithoutStage(repo);
    const useCase = new StartLiveUseCase(repo);

    await expect(useCase.execute(context, 'live-1')).rejects.toMatchObject({
      code: 'STAGE_NOT_PROVISIONED',
    });
  });

  it('rejects a professor who does not own the class', async () => {
    const repo = new FakeLiveSessionRepository();
    seedWaitingLiveWithStage(repo);
    const useCase = new StartLiveUseCase(repo);

    const outsider = buildContext({ role: 'PROFESSOR', userId: 'teacher-2', institutionId: 'institution-1' });

    await expect(useCase.execute(outsider, 'live-1')).rejects.toMatchObject({
      code: 'CLASS_NOT_OWNED',
    });
  });
});
