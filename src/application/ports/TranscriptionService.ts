export interface StartTranscriptionInput {
  readonly jobName: string;
  readonly mediaUri: string;
  readonly languageCode: string;
  readonly maxSpeakerLabels: number;
}

export interface RawTranscriptSegment {
  readonly speakerLabel: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export type TranscriptionJobState = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface CompletedTranscription {
  readonly state: TranscriptionJobState;
  readonly segments: readonly RawTranscriptSegment[];
  readonly failureReason?: string;
}

export interface TranscriptionService {
  startTranscription(input: StartTranscriptionInput): Promise<void>;
  fetchTranscription(jobName: string): Promise<CompletedTranscription>;
}
