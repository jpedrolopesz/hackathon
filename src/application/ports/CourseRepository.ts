import type { Course } from '@/domain/entities/Course';

export interface CourseRepository {
  findById(courseId: string): Promise<Course | null>;
  save(course: Course): Promise<void>;
}
