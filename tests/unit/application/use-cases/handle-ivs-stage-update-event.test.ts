import { describe, expect, it } from 'vitest';
import { HandleIvsStageUpdateEventUseCase } from '@/application/use-cases/handle-ivs-stage-update-event';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import { FakeClassGroupRepository } from './fixtures';
import { FakeIvsRealTimeService, FakeLiveSessionRepository } from './live-fixtures';
import { FakeRecordingRepository } from './recording-fixtures';

const STAGE_ARN = 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage';

function seedLive(repo: FakeLiveSessionRepository, overrides: Partial<LiveSession> = {}): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2026-01-01T14:00:00.000Z',
    status: 'LIVE',
    stageArn: STAGE_ARN,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(live);
  return live;
}

function seedClassGroup(repo: FakeClassGroupRepository): ClassGroup {
  const classGroup: ClassGroup = {
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    name: 'Turma 1',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  repo.seed(classGroup);
  return classGroup;
}

function makeUseCase() {
  const liveSessionRepository = new FakeLiveSessionRepository();
  const recordingRepository = new FakeRecordingRepository();
  const ivs = new FakeIvsRealTimeService();
  const classGroupRepository = new FakeClassGroupRepository();
  const useCase = new HandleIvsStageUpdateEventUseCase(
    liveSessionRepository,
    recordingRepository,
    ivs,
    classGroupRepository,
  );
  return { useCase, liveSessionRepository, recordingRepository, ivs, classGroupRepository };
}

const baseInput = {
  stageArn: STAGE_ARN,
  eventName: 'Participant Published' as const,
  encoderConfigurationArn: 'arn:aws:ivs:us-east-1:123456789012:encoder-configuration/enc',
  storageConfigurationArn: 'arn:aws:ivs:us-east-1:123456789012:storage-configuration/store',
  environmentTag: 'development',
};

describe('HandleIvsStageUpdateEventUseCase', () => {
  it('Participant Unpublished is a no-op — auto-shutdown of the IVS composition is not replicated here', async () => {
    const { useCase, ivs } = makeUseCase();

    await useCase.execute({ ...baseInput, eventName: 'Participant Unpublished' });

    expect(ivs.startCompositionCalls).toHaveLength(0);
  });

  it('an unknown stageArn is discarded, not an error', async () => {
    const { useCase, ivs } = makeUseCase();
    await expect(useCase.execute(baseInput)).resolves.toBeUndefined();
    expect(ivs.startCompositionCalls).toHaveLength(0);
  });

  it('starts a new composition and Recording (STARTING) when none is active', async () => {
    const { useCase, liveSessionRepository, recordingRepository, ivs, classGroupRepository } =
      makeUseCase();
    seedLive(liveSessionRepository);
    seedClassGroup(classGroupRepository);

    await useCase.execute(baseInput);

    expect(ivs.startCompositionCalls).toHaveLength(1);
    expect(ivs.startCompositionCalls[0]?.tags).toEqual({ Environment: 'development' });

    const live = liveSessionRepository.get('live-1');
    expect(live?.activeRecordingId).toBeDefined();
    const recording = recordingRepository.get(live!.activeRecordingId!);
    expect(recording?.status).toBe('STARTING');
    expect(recording?.courseId).toBe('course-1');
  });

  it('is a no-op when a recording is already active and not terminal', async () => {
    const { useCase, liveSessionRepository, recordingRepository, ivs, classGroupRepository } =
      makeUseCase();
    seedLive(liveSessionRepository, { activeRecordingId: 'recording-1' });
    seedClassGroup(classGroupRepository);
    recordingRepository.seed({
      recordingId: 'recording-1',
      liveId: 'live-1',
      courseId: 'course-1',
      institutionId: 'institution-1',
      stageArn: STAGE_ARN,
      status: 'RECORDING',
      startedAt: '2026-01-01T00:00:00.000Z',
      visibility: 'DRAFT',
    });

    await useCase.execute(baseInput);

    expect(ivs.startCompositionCalls).toHaveLength(0);
  });

  it('starts a fresh composition when the previous recording already reached a terminal state (READY)', async () => {
    const { useCase, liveSessionRepository, recordingRepository, ivs, classGroupRepository } =
      makeUseCase();
    seedLive(liveSessionRepository, { activeRecordingId: 'recording-1' });
    seedClassGroup(classGroupRepository);
    recordingRepository.seed({
      recordingId: 'recording-1',
      liveId: 'live-1',
      courseId: 'course-1',
      institutionId: 'institution-1',
      stageArn: STAGE_ARN,
      status: 'READY',
      startedAt: '2026-01-01T00:00:00.000Z',
      visibility: 'DRAFT',
    });

    await useCase.execute(baseInput);

    expect(ivs.startCompositionCalls).toHaveLength(1);
    const live = liveSessionRepository.get('live-1');
    expect(live?.activeRecordingId).not.toBe('recording-1');
  });

  it('reverts (stops) the composition if it loses the race claiming activeRecordingId', async () => {
    const { useCase, liveSessionRepository, ivs, classGroupRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedClassGroup(classGroupRepository);

    // Simula outra invocação concorrente já tendo reivindicado activeRecordingId
    // entre o create() do Recording e a chamada de claimActiveRecording() desta
    // execução — a ConditionExpression real (attribute_not_exists) falharia aqui.
    liveSessionRepository.claimActiveRecording = async () => {
      throw new Error('lost the race');
    };

    await useCase.execute(baseInput);

    expect(ivs.startCompositionCalls).toHaveLength(1);
    expect(ivs.stopCompositionCalls).toHaveLength(1);
    expect(ivs.stopCompositionCalls[0]).toContain(ivs.compositionArnToReturn);
  });
});
