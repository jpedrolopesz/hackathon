export type StudySessionStatus = 'PLANNED' | 'DONE' | 'CANCELLED';

export interface StudySession {
  readonly id: string;
  readonly institutionId: string;
  readonly userId: string;
  readonly disciplineId: string;
  readonly conceptId: string;
  readonly recommendationId: string;
  readonly scheduledFor: string;
  readonly durationMinutes: number;
  readonly status: StudySessionStatus;
  readonly createdAt: string;
}
