import { assertRole } from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { CourseRepository } from '@/application/ports/CourseRepository';
import type { Course } from '@/domain/entities/Course';

export interface CreateCourseInput {
  readonly courseId: string;
  readonly name: string;
}

export class CreateCourseUseCase {
  constructor(private readonly courseRepository: CourseRepository) {}

  async execute(context: AuthenticatedRequestContext, input: CreateCourseInput): Promise<Course> {
    assertRole(context, ['ADMIN']);

    const course: Course = {
      courseId: input.courseId,
      institutionId: context.institutionId,
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    await this.courseRepository.save(course);
    return course;
  }
}
