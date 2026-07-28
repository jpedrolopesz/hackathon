import { describe, expect, it, vi } from 'vitest';
import { FinishLiveUseCase } from '@/application/use-cases/finish-live';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { buildContext } from './fixtures';
import { FakeIvsRealTimeService, FakeLiveSessionRepository } from './live-fixtures';

function seedLiveLive(
  repo: FakeLiveSessionRepository,
  overrides: Partial<LiveSession> = {},
): LiveSession {
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

const context = buildContext({
  role: 'PROFESSOR',
  userId: 'teacher-1',
  institutionId: 'institution-1',
});

describe('FinishLiveUseCase', () => {
  it('transitions LIVE -> ENDING -> ENDED and deletes the stage', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLiveLive(repo);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new FinishLiveUseCase(repo, ivs);

    const result = await useCase.execute(context, 'live-1');

    expect(result.status).toBe('ENDED');
    expect(ivs.deleteStageCalls).toEqual(['arn:aws:ivs:us-east-1:123456789012:stage/fake-stage']);
  });

  it('is idempotent: finishing an already-ENDED live is a no-op success', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLiveLive(repo, { status: 'ENDED' });
    const ivs = new FakeIvsRealTimeService();
    const useCase = new FinishLiveUseCase(repo, ivs);

    const result = await useCase.execute(context, 'live-1');

    expect(result.status).toBe('ENDED');
    expect(ivs.deleteStageCalls).toHaveLength(0);
  });

  it('does not fail the whole operation if DeleteStage errors — ends the live anyway and logs for reconciliation', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLiveLive(repo);
    const ivs = new FakeIvsRealTimeService();
    ivs.deleteStage = async () => {
      throw new Error('DeleteStage failed');
    };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const useCase = new FinishLiveUseCase(repo, ivs);

    const result = await useCase.execute(context, 'live-1');

    expect(result.status).toBe('ENDED');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
