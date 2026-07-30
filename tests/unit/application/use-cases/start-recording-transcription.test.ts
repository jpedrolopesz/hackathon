import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecordingConsentRepository } from '@/application/ports/RecordingConsentRepository';
import type { TranscriptRepository } from '@/application/ports/TranscriptRepository';
import type {
  CompletedTranscription,
  StartTranscriptionInput,
  TranscriptionService,
} from '@/application/ports/TranscriptionService';
import { StartRecordingTranscriptionUseCase } from '@/application/use-cases/start-recording-transcription';
import type { RecordingConsent } from '@/domain/entities/RecordingConsent';
import type {
  Transcript,
  TranscriptStatus,
} from '@/domain/entities/Transcript';
import type { TranscriptSegment } from '@/domain/entities/TranscriptSegment';

class FakeTranscriptRepository implements TranscriptRepository {
  existing: Transcript | null = null;
  readonly saved: Transcript[] = [];
  readonly segments: TranscriptSegment[][] = [];
  readonly statusUpdates: {
    institutionId: string;
    transcriptId: string;
    status: TranscriptStatus;
    failureReason?: string;
  }[] = [];
  findCalls = 0;

  async findByRecordingId(): Promise<Transcript | null> {
    this.findCalls += 1;
    return this.existing;
  }

  async save(transcript: Transcript): Promise<void> {
    this.saved.push(transcript);
    this.existing = transcript;
  }

  async saveSegments(
    segments: readonly TranscriptSegment[],
  ): Promise<void> {
    this.segments.push([...segments]);
  }

  async updateStatus(
    institutionId: string,
    _recordingId: string,
    status: TranscriptStatus,
    failureReason?: string,
  ): Promise<void> {
    this.statusUpdates.push({
      institutionId,
      transcriptId: this.existing?.id ?? '',
      status,
      ...(failureReason === undefined ? {} : { failureReason }),
    });
  }
}

class FakeRecordingConsentRepository
  implements RecordingConsentRepository
{
  consent: RecordingConsent | null = null;
  readonly saved: RecordingConsent[] = [];
  findCalls = 0;

  async findActiveConsent(): Promise<RecordingConsent | null> {
    this.findCalls += 1;
    return this.consent;
  }

  async save(consent: RecordingConsent): Promise<void> {
    this.saved.push(consent);
  }
}

class FakeTranscriptionService implements TranscriptionService {
  readonly started: StartTranscriptionInput[] = [];
  startError: unknown;

  async startTranscription(input: StartTranscriptionInput): Promise<void> {
    this.started.push(input);
    if (this.startError) {
      throw this.startError;
    }
  }

  async fetchTranscription(): Promise<CompletedTranscription> {
    return { state: 'IN_PROGRESS', segments: [] };
  }
}

const input = {
  institutionId: 'institution-fictional',
  liveSessionId: 'live-statistics',
  recordingId: 'recording-statistics',
  disciplineId: 'discipline-statistics',
  participantUserId: 'participant-fictional',
  mediaUri: 's3://media-fictional/recording-statistics.mp4',
  occurredAt: '2026-01-12T10:00:00.000Z',
} as const;

function activeConsent(
  overrides: Partial<RecordingConsent> = {},
): RecordingConsent {
  return {
    id: 'consent-fictional',
    institutionId: 'institution-fictional',
    liveSessionId: 'live-statistics',
    participantUserId: 'participant-fictional',
    purposes: ['TRANSCRIPTION'],
    grantedAt: '2026-01-12T08:00:00.000Z',
    validFrom: '2026-01-12T09:00:00.000Z',
    validUntil: '2026-01-12T11:00:00.000Z',
    revokedAt: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

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
  const consentRepository = new FakeRecordingConsentRepository();
  const transcriptionService = new FakeTranscriptionService();
  const useCase = new StartRecordingTranscriptionUseCase(
    transcriptRepository,
    consentRepository,
    transcriptionService,
  );
  return {
    transcriptRepository,
    consentRepository,
    transcriptionService,
    useCase,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StartRecordingTranscriptionUseCase', () => {
  it('discards without persisting or starting a job when consent is absent', async () => {
    const {
      transcriptRepository,
      consentRepository,
      transcriptionService,
      useCase,
    } = setup();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(useCase.execute(input)).resolves.toEqual({
      outcome: 'DISCARDED_NO_CONSENT',
      reason: 'NO_CONSENT',
    });
    expect(transcriptRepository.findCalls).toBe(1);
    expect(consentRepository.findCalls).toBe(1);
    expect(transcriptRepository.saved).toEqual([]);
    expect(transcriptRepository.statusUpdates).toEqual([]);
    expect(consentRepository.saved).toEqual([]);
    expect(transcriptionService.started).toEqual([]);
  });

  it.each([
    [
      'revoked',
      activeConsent({
        status: 'REVOKED',
        revokedAt: '2026-01-12T09:30:00.000Z',
      }),
      'REVOKED',
    ],
    [
      'expired',
      activeConsent({
        status: 'EXPIRED',
        validUntil: '2026-01-12T09:59:59.000Z',
      }),
      'EXPIRED',
    ],
  ] as const)(
    'discards a %s consent without persisting or starting a job',
    async (_case, consent, reason) => {
      const {
        transcriptRepository,
        consentRepository,
        transcriptionService,
        useCase,
      } = setup();
      consentRepository.consent = consent;
      vi.spyOn(console, 'info').mockImplementation(() => undefined);

      await expect(useCase.execute(input)).resolves.toEqual({
        outcome: 'DISCARDED_NO_CONSENT',
        reason,
      });
      expect(transcriptRepository.saved).toEqual([]);
      expect(transcriptRepository.statusUpdates).toEqual([]);
      expect(transcriptionService.started).toEqual([]);
    },
  );

  it('persists PENDING with consentRef and starts one job', async () => {
    const {
      transcriptRepository,
      consentRepository,
      transcriptionService,
      useCase,
    } = setup();
    consentRepository.consent = activeConsent();

    const result = await useCase.execute(input);

    expect(result).toMatchObject({ outcome: 'STARTED' });
    expect(transcriptRepository.saved).toHaveLength(1);
    expect(transcriptRepository.saved[0]).toMatchObject({
      status: 'PENDING',
      consentRef: 'consent-fictional',
      language: 'pt-BR',
    });
    expect(transcriptionService.started).toEqual([
      {
        jobName: 'recording-recording-statistics',
        mediaUri: 's3://media-fictional/recording-statistics.mp4',
        languageCode: 'pt-BR',
        maxSpeakerLabels: 2,
      },
    ]);
  });

  it('uses the same jobName for the same recordingId across executions', async () => {
    const first = setup();
    const second = setup();
    first.consentRepository.consent = activeConsent();
    second.consentRepository.consent = activeConsent();

    await first.useCase.execute(input);
    await second.useCase.execute(input);

    expect(first.transcriptionService.started[0]?.jobName).toBe(
      second.transcriptionService.started[0]?.jobName,
    );
  });

  it('returns ALREADY_STARTED for an existing PENDING transcript', async () => {
    const {
      transcriptRepository,
      consentRepository,
      transcriptionService,
      useCase,
    } = setup();
    transcriptRepository.existing = transcript();

    await expect(useCase.execute(input)).resolves.toEqual({
      outcome: 'ALREADY_STARTED',
      transcriptId: 'transcript-fictional',
    });
    expect(consentRepository.findCalls).toBe(0);
    expect(transcriptRepository.saved).toEqual([]);
    expect(transcriptionService.started).toEqual([]);
  });

  it('restarts an existing FAILED transcript with the same id', async () => {
    const {
      transcriptRepository,
      consentRepository,
      transcriptionService,
      useCase,
    } = setup();
    transcriptRepository.existing = transcript({ status: 'FAILED' });
    consentRepository.consent = activeConsent();

    await expect(useCase.execute(input)).resolves.toEqual({
      outcome: 'STARTED',
      transcriptId: 'transcript-fictional',
    });
    expect(transcriptRepository.saved[0]).toMatchObject({
      id: 'transcript-fictional',
      status: 'PENDING',
    });
    expect(transcriptionService.started).toHaveLength(1);
  });

  it('marks FAILED and propagates an error from startTranscription', async () => {
    const {
      transcriptRepository,
      consentRepository,
      transcriptionService,
      useCase,
    } = setup();
    const error = new Error('transcription service unavailable');
    consentRepository.consent = activeConsent();
    transcriptionService.startError = error;

    await expect(useCase.execute(input)).rejects.toBe(error);
    expect(transcriptRepository.statusUpdates).toEqual([
      {
        institutionId: 'institution-fictional',
        transcriptId: transcriptRepository.saved[0]?.id,
        status: 'FAILED',
        failureReason: 'transcription service unavailable',
      },
    ]);
  });
});
