import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { assertRole } from '@/application/authorization/guards';
import type { EnrollmentRepository } from '@/application/ports/EnrollmentRepository';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import type { LiveSession } from '@/domain/entities/LiveSession';

const VISIBLE_STATUSES: readonly LiveSession['status'][] = ['SCHEDULED', 'WAITING', 'LIVE'];

/** Lista somente aulas de matrículas ativas do próprio aluno autenticado. */
export class ListUpcomingLivesForStudentUseCase {
  constructor(
    private readonly enrollmentRepository: EnrollmentRepository,
    private readonly liveSessionRepository: LiveSessionRepository,
  ) {}

  async execute(context: AuthenticatedRequestContext): Promise<readonly LiveSession[]> {
    assertRole(context, ['ALUNO']);

    const enrollments = (await this.enrollmentRepository.listByStudent(context.userId)).filter(
      (enrollment) =>
        enrollment.status === 'ACTIVE' && enrollment.institutionId === context.institutionId,
    );
    const lives = await Promise.all(
      enrollments.map((enrollment) => this.liveSessionRepository.listByClass(enrollment.classId)),
    );

    return lives
      .flat()
      .filter(
        (live) =>
          live.institutionId === context.institutionId && VISIBLE_STATUSES.includes(live.status),
      )
      .sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));
  }
}
