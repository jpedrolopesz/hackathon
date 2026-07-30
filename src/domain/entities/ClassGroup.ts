/**
 * Chave: PK=CLASS#{classId}, SK=METADATA. Também grava GSI1PK=TEACHER#{teacherId} /
 * GSI1SK=CLASS#{classId} (padrão de acesso #3 — turmas de um professor).
 */
export interface ClassGroup {
  readonly classId: string;
  readonly courseId: string;
  readonly disciplineId?: string;
  readonly institutionId: string;
  readonly teacherId: string;
  readonly name: string;
  readonly createdAt: string;
}
