import type { LearningEvidence } from '@/domain/entities/LearningEvidence';

export interface LearningEvidenceRepository {
  findByUserAndDiscipline(
    institutionId: string,
    userId: string,
    disciplineId: string,
  ): Promise<readonly LearningEvidence[]>;
  save(evidence: LearningEvidence): Promise<void>;
}
