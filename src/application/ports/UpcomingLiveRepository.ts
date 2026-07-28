export interface UpcomingLiveSummary {
  readonly liveId: string;
  readonly classId: string;
  readonly title: string;
  readonly scheduledStartAt: string;
}

/**
 * Port estreito para os caminhos (c)/(d) de manutenção do padrão de acesso #5
 * (docs/fase-1-arquitetura.md, seção 6): matrícula criada/cancelada depois de uma live
 * já agendada precisa criar/remover as projeções `UPCOMING#` do aluno.
 *
 * `listUpcomingByClass` lê o padrão #4 (lives de uma turma, GSI1) — conceitualmente
 * pertence a um futuro `LiveSessionRepository` da Fase 5, que ainda não existe. Fica
 * aqui, escopado ao mínimo necessário para a Fase 4 fechar matrícula sem duplicar o
 * desenho de `LiveSession` antes da hora.
 */
export interface UpcomingLiveRepository {
  listUpcomingByClass(classId: string): Promise<readonly UpcomingLiveSummary[]>;
  /** Idempotente: reescrever a mesma chave não duplica nem tem efeito colateral. */
  projectForStudent(studentId: string, lives: readonly UpcomingLiveSummary[]): Promise<void>;
  removeForStudent(studentId: string, liveIds: readonly string[]): Promise<void>;
}
