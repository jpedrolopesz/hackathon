export type TranscriptSpeakerRole = 'PROFESSOR' | 'ALUNO' | 'UNKNOWN';

export interface TranscriptSegment {
  readonly id: string;
  readonly transcriptId: string;
  readonly institutionId: string;
  readonly speakerLabel: string;
  readonly speakerRole: TranscriptSpeakerRole;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly consentRef: string;
}
