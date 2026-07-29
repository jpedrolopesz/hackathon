import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), emitMetric: vi.fn() }));

vi.mock('@aws-sdk/client-ivs-realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-ivs-realtime')>();
  return {
    ...actual,
    IVSRealTimeClient: class {
      send = mocks.send;
    },
  };
});
vi.mock('@/shared/observability/structured-log', () => ({
  emitMetric: mocks.emitMetric,
}));

import { IvsRealTimeService } from '@/infrastructure/aws/ivs/ivs-real-time-service';

describe('IvsRealTimeService AWS adapter failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('translates an exhausted IVS throttle into a stable service error', async () => {
    const error = new Error('rate exceeded');
    error.name = 'ThrottlingException';
    mocks.send.mockRejectedValue(error);

    await expect(new IvsRealTimeService().createStage({ name: 'live-1', tags: {} })).rejects.toMatchObject(
      { code: 'SERVICE_UNAVAILABLE' },
    );
    expect(mocks.emitMetric).toHaveBeenCalledWith('IvsThrottles', 1, 'Count', {
      Operation: 'CreateStage',
    });
  });

  it('does not disguise a non-throttling AWS failure', async () => {
    const error = new Error('access denied');
    error.name = 'AccessDeniedException';
    mocks.send.mockRejectedValue(error);

    await expect(new IvsRealTimeService().deleteStage('stage-arn')).rejects.toBe(error);
    expect(mocks.emitMetric).toHaveBeenCalledWith('IvsOperationFailures', 1, 'Count', {
      Operation: 'DeleteStage',
    });
  });

  it('rejects an incomplete CreateParticipantToken response', async () => {
    mocks.send.mockResolvedValue({ participantToken: { participantId: 'participant-1' } });

    await expect(
      new IvsRealTimeService().createParticipantToken({
        stageArn: 'stage-arn',
        userId: 'user-1',
        attributes: {},
        capabilities: ['SUBSCRIBE'],
        durationMinutes: 60,
      }),
    ).rejects.toThrow('CreateParticipantToken não retornou os campos esperados');
  });
});
