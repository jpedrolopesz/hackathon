interface LearningEvidenceBase {
  readonly id: string;
  readonly institutionId: string;
  readonly userId: string;
  readonly disciplineId: string;
  readonly conceptId: string;
  readonly occurredAt: string;
  readonly sourceRef: string;
}

export interface TranscriptLearningEvidence extends LearningEvidenceBase {
  readonly origin: 'TRANSCRIPT';
  readonly consentRef: string;
}

export interface ActivityLearningEvidence extends LearningEvidenceBase {
  readonly origin: 'ACTIVITY';
}

export interface AccessLearningEvidence extends LearningEvidenceBase {
  readonly origin: 'ACCESS';
}

export type LearningEvidence =
  | TranscriptLearningEvidence
  | ActivityLearningEvidence
  | AccessLearningEvidence;
