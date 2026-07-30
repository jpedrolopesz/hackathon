import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptRepository } from '@/application/ports/TranscriptRepository';
import type {
  CompletedTranscription,
  StartTranscriptionInput,
  TranscriptionService,
} from '@/application/ports/TranscriptionService';
import { CompleteRecordingTranscriptionUseCase } from '@/application/use-cases/complete-recording-transcription';
import type {
  Transcript,
  TranscriptStatus,
} from '@/domain/entities/Transcript';
import type { TranscriptSegment } from '@/domain/entities/TranscriptSegment';

class FakeTranscriptRepository implements TranscriptRepository {
  transcript: Transcript | null = null;
  readonly saved: Transcript[] = [];
  readonly savedSegmentBatches: TranscriptSegment[][] = [];
  readonly statusUpdates: {
    institutionId: string;
    transcriptId: string;
    status: TranscriptStatus;
    failureReason?: string;
  }[] = [];

  async findByRecordingId(): Promise<Transcript | null> {
    return this.transcript;
  }

  async save(transcript: Transcript): Promise<void> {
    this.saved.push(transcript);
  }

  async saveSegments(
    segments: readonly TranscriptSegment[],
  ): Promise<void> {
    this.savedSegmentBatches.push([...segments]);
  }

  async updateStatus(
    institutionId: string,
    _recordingId: string,
    status: TranscriptStatus,
    failureReason?: string,
  ): Promise<void> {
    this.statusUpdates.push({
      institutionId,
      transcriptId: this.transcript?.id ?? '',
      status,
      ...(failureReason === undefined ? {} : { failureReason }),
    });
  }
}

class FakeTranscriptionService implements TranscriptionService {
  result: CompletedTranscription = {
    state: 'IN_PROGRESS',
    segments: [],
  };
  readonly fetchedJobNames: string[] = [];
  readonly started: StartTranscriptionInput[] = [];

  async startTranscription(input: StartTranscriptionInput): Promise<void> {
    this.started.push(input);
  }

  async fetchTranscription(
    jobName: string,
  ): Promise<CompletedTranscription> {
    this.fetchedJobNames.push(jobName);
    return this.result;
  }
}

const input = {
  institutionId: 'institution-fictional',
  recordingId: 'recording-statistics',
  jobName: 'recording-recording-statistics',
  occurredAt: '2026-01-12T10:30:00.000Z',
} as const;

function transcript(
  overrides: Partial<Transcript> = {},
): Transcript {
  return {
    id: 'transcript-fictional',
    institutionId: 'institution-fictional',
    liveSessionId: 'live-statistics',
    recordingId: 'recording-statistics',
    disciplineId: 'discipline-statistics',
    language: 'pt-BR',
    consentRef: 'consent-fictional',
    status: 'PENDING',
    createdAt: '2026-01-12T10:00:00.000Z',
    ...overrides,
  };
}

function setup() {
  const transcriptRepository = new FakeTranscriptRepository();
  const transcriptionService = new FakeTranscriptionService();
  const useCase = new CompleteRecordingTranscriptionUseCase(
    transcriptRepository,
    transcriptionService,
  );
  return { transcriptRepository, transcriptionService, useCase };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CompleteRecordingTranscriptionUseCase', () => {
  it('persists completed segments with roles and marks the transcript COMPLETED', async () => {
    const { transcriptRepository, transcriptionService, useCase } = setup();
    transcriptRepository.transcript = transcript();
    transcriptionService.result = {
      state: 'COMPLETED',
      segments: [
        {
          speakerLabel: 'spk_0',
          startMs: 0,
          endMs: 8_000,
          text: 'Explicação fictícia sobre média.',
        },
        {
          speakerLabel: 'spk_1',
          startMs: 8_000,
          endMs: 10_000,
          text: 'Pergunta fictícia sobre mediana.',
        },
      ],
    };

    await expect(useCase.execute(input)).resolves.toEqual({
      outcome: 'COMPLETED',
      transcriptId: 'transcript-fictional',
      segmentCount: 2,
    });
    expect(transcriptRepository.savedSegmentBatches).toHaveLength(1);
    expect(transcriptRepository.savedSegmentBatches[0]).toEqual([
      expect.objectContaining({
        speakerLabel: 'spk_0',
        speakerRole: 'PROFESSOR',
        consentRef: 'consent-fictional',
      }),
      expect.objectContaining({
        speakerLabel: 'spk_1',
        speakerRole: 'ALUNO',
        consentRef: 'consent-fictional',
      }),
    ]);
    expect(transcriptRepository.statusUpdates).toEqual([
      {
        institutionId: 'institution-fictional',
        transcriptId: 'transcript-fictional',
        status: 'COMPLETED',
      },
    ]);
  });

  it('returns TRANSCRIPT_NOT_FOUND without persisting or throwing', async () => {
    const { transcriptRepository, transcriptionService, useCase } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(useCase.execute(input)).resolves.toEqual({
      outcome: 'TRANSCRIPT_NOT_FOUND',
    });
    expect(transcriptionService.fetchedJobNames).toEqual([]);
    expect(transcriptRepository.savedSegmentBatches).toEqual([]);
    expect(transcriptRepository.statusUpdates).toEqual([]);
  });

  it('returns ALREADY_COMPLETED without persisting new segments', async () => {
    const { transcriptRepository, transcriptionService, useCase } = setup();
    transcriptRepository.transcript = transcript({ status: 'COMPLETED' });

    await expect(useCase.execute(input)).resolves.toEqual({
      outcome: 'ALREADY_COMPLETED',
      transcriptId: 'transcript-fictional',
    });
    expect(transcriptionService.fetchedJobNames).toEqual([]);
    expect(transcriptRepository.savedSegmentBatches).toEqual([]);
  });

  it('marks the transcript FAILED with the job failure reason', async () => {
    const { transcriptRepository, transcriptionService, useCase } = setup();
    transcriptRepository.transcript = transcript();
    transcriptionService.result = {
      state: 'FAILED',
      segments: [],
      failureReason: 'Falha fictícia no processamento.',
    };

    await expect(useCase.execute(input)).resolves.toEqual({
      outcome: 'FAILED',
      transcriptId: 'transcript-fictional',
      reason: 'Falha fictícia no processamento.',
    });
    expect(transcriptRepository.savedSegmentBatches).toEqual([]);
    expect(transcriptRepository.statusUpdates).toEqual([
      {
        institutionId: 'institution-fictional',
        transcriptId: 'transcript-fictional',
        status: 'FAILED',
        failureReason: 'Falha fictícia no processamento.',
      },
    ]);
  });

  it('does not persist segments while the job is IN_PROGRESS', async () => {
    const { transcriptRepository, useCase } = setup();
    transcriptRepository.transcript = transcript();

    await expect(useCase.execute(input)).resolves.toEqual({
      outcome: 'FAILED',
      transcriptId: 'transcript-fictional',
      reason: 'Transcription job is still in progress.',
    });
    expect(transcriptRepository.savedSegmentBatches).toEqual([]);
    expect(transcriptRepository.statusUpdates).toEqual([]);
  });

  it('copies the transcript consentRef to every persisted segment', async () => {
    const { transcriptRepository, transcriptionService, useCase } = setup();
    transcriptRepository.transcript = transcript({
      consentRef: 'consent-audit-fictional',
    });
    transcriptionService.result = {
      state: 'COMPLETED',
      segments: [
        {
          speakerLabel: 'spk_0',
          startMs: 0,
          endMs: 5_000,
          text: 'Primeiro segmento fictício.',
        },
        {
          speakerLabel: 'spk_1',
          startMs: 5_000,
          endMs: 7_000,
          text: 'Segundo segmento fictício.',
        },
      ],
    };

    await useCase.execute(input);

    const persistedSegments =
      transcriptRepository.savedSegmentBatches.flat();
    expect(persistedSegments).toHaveLength(2);
    expect(
      persistedSegments.every(
        (segment) => segment.consentRef === 'consent-audit-fictional',
      ),
    ).toBe(true);
  });
});
