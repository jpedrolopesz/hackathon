import type { Enrollment } from '@/domain/entities/Enrollment';

export interface EnrollmentRepository {
  find(studentId: string, classId: string): Promise<Enrollment | null>;
  listByStudent(studentId: string): Promise<readonly Enrollment[]>;
  save(enrollment: Enrollment): Promise<void>;
  cancel(studentId: string, classId: string): Promise<void>;
}
