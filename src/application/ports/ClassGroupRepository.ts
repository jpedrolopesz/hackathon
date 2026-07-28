import type { ClassGroup } from '@/domain/entities/ClassGroup';

export interface ClassGroupRepository {
  findById(classId: string): Promise<ClassGroup | null>;
  save(classGroup: ClassGroup): Promise<void>;
}
