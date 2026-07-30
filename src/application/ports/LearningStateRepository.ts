import type { LearningState } from '@/domain/entities/LearningState';

export interface LearningStateRepository {
  findByUserAndDiscipline(
    institutionId: string,
    userId: string,
    disciplineId: string,
  ): Promise<readonly LearningState[]>;
  saveMany(states: readonly LearningState[]): Promise<void>;
}
