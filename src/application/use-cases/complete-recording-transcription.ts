import { ulid } from 'ulid';
import type { TranscriptRepository } from '@/application/ports/TranscriptRepository';
import type { TranscriptionService } from '@/application/ports/TranscriptionService';
import type { TranscriptSegment } from '@/domain/entities/TranscriptSegment';
import { resolveSpeakerRoles } from '@/domain/services/resolve-speaker-roles';
import { structuredLog } from '@/shared/observability/structured-log';

export interface CompleteRecordingTranscriptionInput {
  readonly institutionId: string;
  readonly recordingId: string;
  readonly jobName: string;
  readonly occurredAt: string;
}

export type CompleteRecordingTranscriptionResult =
  | {
      readonly outcome: 'COMPLETED';
      readonly transcriptId: string;
      readonly segmentCount: number;
    }
  | { readonly outcome: 'ALREADY_COMPLETED'; readonly transcriptId: string }
  | { readonly outcome: 'TRANSCRIPT_NOT_FOUND' }
  | {
      readonly outcome: 'FAILED';
      readonly transcriptId: string;
      readonly reason: string;
    };

export class CompleteRecordingTranscriptionUseCase {
  constructor(
    private readonly transcriptRepository: TranscriptRepository,
    private readonly transcriptionService: TranscriptionService,
  ) {}

  async execute(
    input: CompleteRecordingTranscriptionInput,
  ): Promise<CompleteRecordingTranscriptionResult> {
    const transcript = await this.transcriptRepository.findByRecordingId(
      input.institutionId,
      input.recordingId,
    );

    if (!transcript) {
      structuredLog('warn', {
        event: 'recording_transcription.completion',
        institutionId: input.institutionId,
        recordingId: input.recordingId,
        jobName: input.jobName,
        occurredAt: input.occurredAt,
        decision: 'TRANSCRIPT_NOT_FOUND',
      });
      return { outcome: 'TRANSCRIPT_NOT_FOUND' };
    }

    if (transcript.status === 'COMPLETED') {
      return {
        outcome: 'ALREADY_COMPLETED',
        transcriptId: transcript.id,
      };
    }

    const completed =
      await this.transcriptionService.fetchTranscription(input.jobName);

    if (completed.state === 'FAILED') {
      const reason =
        completed.failureReason ?? 'Transcription job failed without a reason.';
      await this.transcriptRepository.updateStatus(
        input.institutionId,
        input.recordingId,
        'FAILED',
        reason,
      );
      return { outcome: 'FAILED', transcriptId: transcript.id, reason };
    }

    if (completed.state === 'IN_PROGRESS') {
      return {
        outcome: 'FAILED',
        transcriptId: transcript.id,
        reason: 'Transcription job is still in progress.',
      };
    }

    const roles = resolveSpeakerRoles(completed.segments);
    const segments: TranscriptSegment[] = completed.segments.map((segment) => ({
      id: ulid(),
      transcriptId: transcript.id,
      institutionId: transcript.institutionId,
      speakerLabel: segment.speakerLabel,
      speakerRole: roles.get(segment.speakerLabel) ?? 'UNKNOWN',
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      consentRef: transcript.consentRef,
    }));

    await this.transcriptRepository.saveSegments(segments);
    await this.transcriptRepository.updateStatus(
      input.institutionId,
      input.recordingId,
      'COMPLETED',
    );

    return {
      outcome: 'COMPLETED',
      transcriptId: transcript.id,
      segmentCount: segments.length,
    };
  }
}
