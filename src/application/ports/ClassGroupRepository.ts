import type { ClassGroup } from '@/domain/entities/ClassGroup';

export interface ClassGroupRepository {
  findById(classId: string): Promise<ClassGroup | null>;
  /** Padrão de acesso #3 do README — turmas de um professor (GSI1). */
  findByTeacher(teacherId: string): Promise<readonly ClassGroup[]>;
  save(classGroup: ClassGroup): Promise<void>;
}
