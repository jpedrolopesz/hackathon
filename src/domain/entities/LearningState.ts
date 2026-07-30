export type LearningStateValue =
  | 'NOT_STARTED'
  | 'BLOCKED'
  | 'IN_PROGRESS'
  | 'NEEDS_PRACTICE'
  | 'POSSIBLE_DIFFICULTY'
  | 'NEEDS_REVIEW'
  | 'LIKELY_UNDERSTOOD';

export interface LearningState {
  readonly institutionId: string;
  readonly userId: string;
  readonly disciplineId: string;
  readonly conceptId: string;
  readonly state: LearningStateValue;
  readonly explanation: string;
  readonly ruleVersion: string;
  readonly evidenceIds: readonly string[];
  readonly computedAt: string;
}
