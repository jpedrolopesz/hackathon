import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@aws-sdk/client-transcribe', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@aws-sdk/client-transcribe')>();
  return {
    ...actual,
    TranscribeClient: class {
      send = mocks.send;
    },
  };
});

import { ServiceUnavailableError } from '@/domain/errors/ServiceUnavailableError';
import { TranscribeTranscriptionService } from '@/infrastructure/aws/transcribe/transcribe-transcription-service';

describe('TranscribeTranscriptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a speaker-labeled job without an output bucket', async () => {
    mocks.send.mockResolvedValue({});

    await new TranscribeTranscriptionService().startTranscription({
      jobName: 'recording-recording-statistics',
      mediaUri: 's3://media-fictional/recording-statistics.mp4',
      languageCode: 'pt-BR',
      maxSpeakerLabels: 2,
    });

    const command = mocks.send.mock.calls[0]?.[0];
    expect(command.input).toMatchObject({
      TranscriptionJobName: 'recording-recording-statistics',
      LanguageCode: 'pt-BR',
      Media: {
        MediaFileUri: 's3://media-fictional/recording-statistics.mp4',
      },
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 2,
      },
    });
    expect(command.input).not.toHaveProperty('OutputBucketName');
  });

  it('treats ConflictException as an idempotent success', async () => {
    const error = new Error('job already exists');
    error.name = 'ConflictException';
    mocks.send.mockRejectedValue(error);

    await expect(
      new TranscribeTranscriptionService().startTranscription({
        jobName: 'recording-recording-statistics',
        mediaUri: 's3://media-fictional/recording-statistics.mp4',
        languageCode: 'pt-BR',
        maxSpeakerLabels: 2,
      }),
    ).resolves.toBeUndefined();
  });

  it('returns IN_PROGRESS without fetching output', async () => {
    mocks.send.mockResolvedValue({
      TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' },
    });

    await expect(
      new TranscribeTranscriptionService().fetchTranscription(
        'recording-recording-statistics',
      ),
    ).resolves.toEqual({ state: 'IN_PROGRESS', segments: [] });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns the AWS failure reason for a failed job', async () => {
    mocks.send.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobStatus: 'FAILED',
        FailureReason: 'Falha fictícia no áudio.',
      },
    });

    await expect(
      new TranscribeTranscriptionService().fetchTranscription(
        'recording-recording-statistics',
      ),
    ).resolves.toEqual({
      state: 'FAILED',
      segments: [],
      failureReason: 'Falha fictícia no áudio.',
    });
  });

  it('fetches and parses completed transcription output', async () => {
    mocks.send.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobStatus: 'COMPLETED',
        Transcript: {
          TranscriptFileUri: 'https://transcribe-fictional/output.json',
        },
      },
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: {
          audio_segments: [
            {
              speaker_label: 'spk_1',
              start_time: '12.34',
              end_time: '15.00',
              transcript: 'Qual a diferença entre média e mediana?',
            },
          ],
        },
      }),
    });

    await expect(
      new TranscribeTranscriptionService().fetchTranscription(
        'recording-recording-statistics',
      ),
    ).resolves.toEqual({
      state: 'COMPLETED',
      segments: [
        {
          speakerLabel: 'spk_1',
          startMs: 12_340,
          endMs: 15_000,
          text: 'Qual a diferença entre média e mediana?',
        },
      ],
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://transcribe-fictional/output.json',
    );
  });

  it('translates a non-ok output response to ServiceUnavailableError', async () => {
    mocks.send.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobStatus: 'COMPLETED',
        Transcript: {
          TranscriptFileUri: 'https://transcribe-fictional/unavailable.json',
        },
      },
    });
    mocks.fetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(
      new TranscribeTranscriptionService().fetchTranscription(
        'recording-recording-statistics',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('returns FAILED without throwing when the job does not exist', async () => {
    const error = new Error('job not found');
    error.name = 'NotFoundException';
    mocks.send.mockRejectedValue(error);

    await expect(
      new TranscribeTranscriptionService().fetchTranscription(
        'recording-recording-missing',
      ),
    ).resolves.toEqual({
      state: 'FAILED',
      segments: [],
      failureReason:
        'O job de transcrição recording-recording-missing não foi encontrado.',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects an unexpected successful response without a job', async () => {
    mocks.send.mockResolvedValue({});

    await expect(
      new TranscribeTranscriptionService().fetchTranscription(
        'recording-recording-statistics',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
