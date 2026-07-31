import type { DetectedQuestion } from '@/domain/entities/DetectedQuestion';
import type { Discipline } from '@/domain/entities/Discipline';
import type { GraphEdge } from '@/domain/entities/GraphEdge';
import type { GraphNode } from '@/domain/entities/GraphNode';
import type { LearningEvidence } from '@/domain/entities/LearningEvidence';
import type { LearningState } from '@/domain/entities/LearningState';

export interface InstitutionalGraph {
  readonly discipline: Discipline | null;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface UserGraphOverlay {
  readonly states: readonly LearningState[];
  readonly transcriptEvidences: readonly LearningEvidence[];
  readonly detectedQuestions: readonly DetectedQuestion[];
}

/**
 * Cada método executa exatamente uma Query e nenhum utiliza Scan. A soma das duas
 * consultas é o orçamento total do endpoint de Graph View.
 */
export interface GraphViewRepository {
  findInstitutionalGraph(
    institutionId: string,
    disciplineId: string,
  ): Promise<InstitutionalGraph>;
  findUserOverlay(
    institutionId: string,
    userId: string,
    disciplineId: string,
  ): Promise<UserGraphOverlay>;
}
