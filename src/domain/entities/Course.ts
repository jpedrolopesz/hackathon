/** Chave: PK=COURSE#{courseId}, SK=METADATA (GetItem consistente, mesmo padrão da live). */
export interface Course {
  readonly courseId: string;
  readonly institutionId: string;
  readonly name: string;
  readonly createdAt: string;
}
