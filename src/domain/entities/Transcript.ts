export type TranscriptStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface Transcript {
  readonly id: string;
  readonly institutionId: string;
  readonly liveSessionId: string;
  readonly recordingId: string;
  readonly disciplineId: string;
  readonly language: string;
  readonly consentRef: string;
  readonly status: TranscriptStatus;
  readonly createdAt: string;
}
