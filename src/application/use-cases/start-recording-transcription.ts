import { ulid } from 'ulid';
import type { RecordingConsentRepository } from '@/application/ports/RecordingConsentRepository';
import type { TranscriptRepository } from '@/application/ports/TranscriptRepository';
import type { TranscriptionService } from '@/application/ports/TranscriptionService';
import type { Transcript } from '@/domain/entities/Transcript';
import {
  evaluateRecordingConsent,
  type RecordingConsentDeniedReason,
} from '@/domain/services/evaluate-recording-consent';
import { structuredLog } from '@/shared/observability/structured-log';

export interface StartRecordingTranscriptionInput {
  readonly institutionId: string;
  readonly liveSessionId: string;
  readonly recordingId: string;
  readonly disciplineId: string;
  readonly participantUserId: string;
  readonly mediaUri: string;
  readonly occurredAt: string;
}

export type StartRecordingTranscriptionResult =
  | { readonly outcome: 'STARTED'; readonly transcriptId: string }
  | { readonly outcome: 'ALREADY_STARTED'; readonly transcriptId: string }
  | {
      readonly outcome: 'DISCARDED_NO_CONSENT';
      readonly reason: RecordingConsentDeniedReason;
    };

export class StartRecordingTranscriptionUseCase {
  constructor(
    private readonly transcriptRepository: TranscriptRepository,
    private readonly recordingConsentRepository: RecordingConsentRepository,
    private readonly transcriptionService: TranscriptionService,
  ) {}

  async execute(
    input: StartRecordingTranscriptionInput,
  ): Promise<StartRecordingTranscriptionResult> {
    const existing = await this.transcriptRepository.findByRecordingId(
      input.institutionId,
      input.recordingId,
    );

    if (existing && existing.status !== 'FAILED') {
      return {
        outcome: 'ALREADY_STARTED',
        transcriptId: existing.id,
      };
    }

    const consent =
      await this.recordingConsentRepository.findActiveConsent(
        input.institutionId,
        input.liveSessionId,
        input.participantUserId,
        input.occurredAt,
      );
    const evaluation = evaluateRecordingConsent(consent, input.occurredAt);

    if (!evaluation.allowed) {
      structuredLog('info', {
        event: 'recording_transcription.gate',
        institutionId: input.institutionId,
        liveSessionId: input.liveSessionId,
        recordingId: input.recordingId,
        disciplineId: input.disciplineId,
        participantUserId: input.participantUserId,
        reason: evaluation.reason,
        decision: 'DISCARDED',
        decisionTimestamp: new Date().toISOString(),
      });
      return {
        outcome: 'DISCARDED_NO_CONSENT',
        reason: evaluation.reason,
      };
    }

    const transcript: Transcript = {
      id: existing?.id ?? ulid(),
      institutionId: input.institutionId,
      liveSessionId: input.liveSessionId,
      recordingId: input.recordingId,
      disciplineId: input.disciplineId,
      language: 'pt-BR',
      consentRef: evaluation.consentRef,
      status: 'PENDING',
      createdAt: input.occurredAt,
    };
    await this.transcriptRepository.save(transcript);

    // Formato determinístico: recording-{recordingId}.
    const jobName = `recording-${input.recordingId}`;

    try {
      await this.transcriptionService.startTranscription({
        jobName,
        mediaUri: input.mediaUri,
        languageCode: 'pt-BR',
        maxSpeakerLabels: 2,
      });
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : String(error);
      await this.transcriptRepository.updateStatus(
        input.institutionId,
        input.recordingId,
        'FAILED',
        failureReason,
      );
      throw error;
    }

    return { outcome: 'STARTED', transcriptId: transcript.id };
  }
}
