export type EnrollmentStatus = 'ACTIVE' | 'CANCELED';

/**
 * Chave: PK=USER#{studentId}, SK=ENROLLMENT#{classId} (padrões de acesso #2 e #8).
 * `courseName`/`className` denormalizados para satisfazer o padrão #2 (listar cursos
 * de um aluno) sem join.
 */
export interface Enrollment {
  readonly studentId: string;
  readonly classId: string;
  readonly courseId: string;
  readonly institutionId: string;
  readonly courseName: string;
  readonly className: string;
  readonly enrolledAt: string;
  readonly status: EnrollmentStatus;
}
