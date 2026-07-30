export interface DetectedQuestion {
  readonly id: string;
  readonly institutionId: string;
  readonly userId: string;
  readonly transcriptId: string;
  readonly disciplineId: string;
  readonly segmentIds: readonly string[];
  readonly summary: string;
  readonly detectedAt: string;
  readonly consentRef: string;
}
