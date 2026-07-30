import type { GraphEdge } from '@/domain/entities/GraphEdge';

export interface GraphRepository {
  /**
   * Retorna somente arestas PREREQUISITE_OF, necessárias à propagação do
   * recálculo. A leitura deve usar o padrão de acesso por disciplina, nunca Scan.
   */
  findPrerequisiteEdges(
    institutionId: string,
    disciplineId: string,
  ): Promise<readonly GraphEdge[]>;
}
