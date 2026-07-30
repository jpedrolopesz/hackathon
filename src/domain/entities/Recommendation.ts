export type RecommendationStatus = 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'IGNORED';

export interface Recommendation {
  readonly id: string;
  readonly institutionId: string;
  readonly userId: string;
  readonly disciplineId: string;
  readonly conceptId: string;
  readonly detectedQuestionId: string;
  readonly guidanceText: string;
  readonly citedMaterialIds: readonly string[];
  readonly status: RecommendationStatus;
  readonly proposedAt: string;
  readonly decidedAt: string | null;
}
