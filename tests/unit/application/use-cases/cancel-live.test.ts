import { describe, expect, it } from 'vitest';
import { CancelLiveUseCase } from '@/application/use-cases/cancel-live';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { buildContext } from './fixtures';
import { FakeIvsRealTimeService, FakeLiveSessionRepository } from './live-fixtures';

function seedLive(
  repo: FakeLiveSessionRepository,
  overrides: Partial<LiveSession> = {},
): LiveSession {
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
    ...overrides,
  };
  repo.seed(live);
  return live;
}

const context = buildContext({
  role: 'PROFESSOR',
  userId: 'teacher-1',
  institutionId: 'institution-1',
});

describe('CancelLiveUseCase', () => {
  it('cancels a SCHEDULED live with no stage — nothing to clean up', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLive(repo);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new CancelLiveUseCase(repo, ivs);

    const result = await useCase.execute(context, 'live-1');

    expect(result.status).toBe('CANCELED');
    expect(ivs.deleteStageCalls).toHaveLength(0);
  });

  it('deletes an orphaned stage when canceling a live that was already WAITING (item 3: Stage órfão)', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLive(repo, {
      status: 'WAITING',
      stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage',
    });
    const ivs = new FakeIvsRealTimeService();
    const useCase = new CancelLiveUseCase(repo, ivs);

    const result = await useCase.execute(context, 'live-1');

    expect(result.status).toBe('CANCELED');
    expect(ivs.deleteStageCalls).toEqual(['arn:aws:ivs:us-east-1:123456789012:stage/fake-stage']);
  });

  it('is idempotent: canceling an already-CANCELED live is a no-op success', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLive(repo, { status: 'CANCELED' });
    const ivs = new FakeIvsRealTimeService();
    const useCase = new CancelLiveUseCase(repo, ivs);

    const result = await useCase.execute(context, 'live-1');

    expect(result.status).toBe('CANCELED');
  });

  it('refuses to cancel a live that is already LIVE', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLive(repo, { status: 'LIVE' });
    const ivs = new FakeIvsRealTimeService();
    const useCase = new CancelLiveUseCase(repo, ivs);

    await expect(useCase.execute(context, 'live-1')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });
});
