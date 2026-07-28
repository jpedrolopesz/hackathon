import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { ClassGroupRepository } from '@/application/ports/ClassGroupRepository';
import type { CourseRepository } from '@/application/ports/CourseRepository';
import type { EnrollmentRepository } from '@/application/ports/EnrollmentRepository';
import type {
  UpcomingLiveRepository,
  UpcomingLiveSummary,
} from '@/application/ports/UpcomingLiveRepository';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import type { Course } from '@/domain/entities/Course';
import type { Enrollment } from '@/domain/entities/Enrollment';
import type { Role } from '@/domain/value-objects/Role';

export function buildContext(
  overrides: Partial<AuthenticatedRequestContext> = {},
): AuthenticatedRequestContext {
  return {
    userId: 'user-1',
    institutionId: 'institution-1',
    role: 'ADMIN' as Role,
    ...overrides,
  };
}

export class FakeCourseRepository implements CourseRepository {
  private readonly store = new Map<string, Course>();

  seed(course: Course): void {
    this.store.set(course.courseId, course);
  }

  async findById(courseId: string): Promise<Course | null> {
    return this.store.get(courseId) ?? null;
  }

  async save(course: Course): Promise<void> {
    this.store.set(course.courseId, course);
  }
}

export class FakeClassGroupRepository implements ClassGroupRepository {
  private readonly store = new Map<string, ClassGroup>();

  seed(classGroup: ClassGroup): void {
    this.store.set(classGroup.classId, classGroup);
  }

  async findById(classId: string): Promise<ClassGroup | null> {
    return this.store.get(classId) ?? null;
  }

  async save(classGroup: ClassGroup): Promise<void> {
    this.store.set(classGroup.classId, classGroup);
  }
}

export class FakeEnrollmentRepository implements EnrollmentRepository {
  private readonly store = new Map<string, Enrollment>();

  private key(studentId: string, classId: string): string {
    return `${studentId}#${classId}`;
  }

  seed(enrollment: Enrollment): void {
    this.store.set(this.key(enrollment.studentId, enrollment.classId), enrollment);
  }

  async find(studentId: string, classId: string): Promise<Enrollment | null> {
    return this.store.get(this.key(studentId, classId)) ?? null;
  }

  async save(enrollment: Enrollment): Promise<void> {
    this.store.set(this.key(enrollment.studentId, enrollment.classId), enrollment);
  }

  async cancel(studentId: string, classId: string): Promise<void> {
    const existing = this.store.get(this.key(studentId, classId));
    if (existing) {
      this.store.set(this.key(studentId, classId), { ...existing, status: 'CANCELED' });
    }
  }
}

export class FakeUpcomingLiveRepository implements UpcomingLiveRepository {
  readonly projections = new Map<string, UpcomingLiveSummary[]>();
  private readonly livesByClass = new Map<string, UpcomingLiveSummary[]>();

  seedUpcomingLives(classId: string, lives: readonly UpcomingLiveSummary[]): void {
    this.livesByClass.set(classId, [...lives]);
  }

  async listUpcomingByClass(classId: string): Promise<readonly UpcomingLiveSummary[]> {
    return this.livesByClass.get(classId) ?? [];
  }

  async projectForStudent(studentId: string, lives: readonly UpcomingLiveSummary[]): Promise<void> {
    const current = this.projections.get(studentId) ?? [];
    const byLiveId = new Map(current.map((live) => [live.liveId, live]));
    for (const live of lives) {
      byLiveId.set(live.liveId, live);
    }
    this.projections.set(studentId, [...byLiveId.values()]);
  }

  async removeForStudent(studentId: string, liveIds: readonly string[]): Promise<void> {
    const current = this.projections.get(studentId) ?? [];
    const liveIdSet = new Set(liveIds);
    this.projections.set(
      studentId,
      current.filter((live) => !liveIdSet.has(live.liveId)),
    );
  }
}
