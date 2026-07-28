import { describe, expect, it } from 'vitest';
import { ProvisionLiveStageUseCase } from '@/application/use-cases/provision-live-stage';
import { ServiceUnavailableError } from '@/domain/errors/ServiceUnavailableError';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { FakeIvsRealTimeService, FakeLiveSessionRepository } from './live-fixtures';

function seedScheduledLive(repo: FakeLiveSessionRepository): LiveSession {
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

describe('ProvisionLiveStageUseCase — ordem de operações (item 3) e cotas fixas do IVS (item 1)', () => {
  it('reserves the WAITING transition before calling CreateStage, then attaches the stageArn', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    seedScheduledLive(liveSessionRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new ProvisionLiveStageUseCase(liveSessionRepository, ivs);

    const result = await useCase.execute('live-1', 'development');

    expect(result.status).toBe('WAITING');
    expect(result.stageArn).toBe(ivs.stageArnToReturn);
    expect(ivs.createStageCalls).toHaveLength(1);
    // Tag Environment obrigatória — é o que a Condition aws:RequestTag/Environment do
    // IAM (infrastructure/stacks/api-stack.ts) exige para a stage ser utilizável depois.
    expect(ivs.createStageCalls[0]?.tags['Environment']).toBe('development');
  });

  it('is idempotent: calling twice does not create a second Stage', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    seedScheduledLive(liveSessionRepository);
    const ivs = new FakeIvsRealTimeService();
    const useCase = new ProvisionLiveStageUseCase(liveSessionRepository, ivs);

    await useCase.execute('live-1', 'development');
    await useCase.execute('live-1', 'development');

    expect(ivs.createStageCalls).toHaveLength(1);
  });

  it('reverts to SCHEDULED (never FAILED) when CreateStage is throttled — throttling is not a real failure', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    seedScheduledLive(liveSessionRepository);
    const ivs = new FakeIvsRealTimeService();
    ivs.throwOnCreateStage = new ServiceUnavailableError(
      'O serviço está temporariamente sobrecarregado. Tente novamente em instantes.',
      'SERVICE_UNAVAILABLE',
      'IVS ThrottlingException on CreateStage after SDK retries exhausted',
    );
    const useCase = new ProvisionLiveStageUseCase(liveSessionRepository, ivs);

    await expect(useCase.execute('live-1', 'development')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });

    const live = liveSessionRepository.get('live-1');
    expect(live?.status).toBe('SCHEDULED');
    expect(live?.status).not.toBe('FAILED');
    expect(live?.stageArn).toBeUndefined();
  });

  it('reverts to SCHEDULED on any other CreateStage failure too, not just throttling', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    seedScheduledLive(liveSessionRepository);
    const ivs = new FakeIvsRealTimeService();
    ivs.throwOnCreateStage = new Error('boom');
    const useCase = new ProvisionLiveStageUseCase(liveSessionRepository, ivs);

    await expect(useCase.execute('live-1', 'development')).rejects.toThrow('boom');

    expect(liveSessionRepository.get('live-1')?.status).toBe('SCHEDULED');
  });

  it('after reverting, a retry succeeds normally (no orphaned WAITING state)', async () => {
    const liveSessionRepository = new FakeLiveSessionRepository();
    seedScheduledLive(liveSessionRepository);
    const ivs = new FakeIvsRealTimeService();
    ivs.throwOnCreateStage = new Error('transient failure');
    const useCase = new ProvisionLiveStageUseCase(liveSessionRepository, ivs);

    await expect(useCase.execute('live-1', 'development')).rejects.toThrow();

    ivs.throwOnCreateStage = undefined;
    const result = await useCase.execute('live-1', 'development');

    expect(result.status).toBe('WAITING');
    expect(result.stageArn).toBe(ivs.stageArnToReturn);
  });
});
