import type { StudySession } from '@/domain/entities/StudySession';

export interface StudySessionRepository {
  /**
   * Porta somente de leitura nesta etapa; operações de escrita serão adicionadas
   * na Etapa 10, quando o aceite de uma recomendação criar a sessão.
   */
  findByUserAndDiscipline(
    institutionId: string,
    userId: string,
    disciplineId: string,
  ): Promise<readonly StudySession[]>;
}
