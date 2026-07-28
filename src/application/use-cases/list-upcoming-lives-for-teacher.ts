import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { assertRole } from '@/application/authorization/guards';
import type { ClassGroupRepository } from '@/application/ports/ClassGroupRepository';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import type { LiveSession } from '@/domain/entities/LiveSession';

const ACTIVE_STATUSES: readonly LiveSession['status'][] = ['DRAFT', 'SCHEDULED', 'WAITING', 'LIVE'];

/**
 * Seção 13 do README: "visualizar próximas aulas" no painel do professor. Sem GSI
 * dedicado para "lives de um professor" — o padrão de acesso #3 já existente
 * (turmas de um professor, GSI1PK=TEACHER#) resolve as TURMAS; a partir delas,
 * consulta as lives de cada uma (padrão #4, GSI1PK=CLASS#). N+1 (uma query por
 * turma) é aceitável aqui: o número de turmas de um professor é pequeno (dezenas,
 * não milhares) — um índice adicional só para achatar isso não se paga ainda.
 */
export class ListUpcomingLivesForTeacherUseCase {
  constructor(
    private readonly classGroupRepository: ClassGroupRepository,
    private readonly liveSessionRepository: LiveSessionRepository,
  ) {}

  async execute(context: AuthenticatedRequestContext): Promise<readonly LiveSession[]> {
    assertRole(context, ['PROFESSOR', 'ADMIN']);

    const classGroups = await this.classGroupRepository.findByTeacher(context.userId);
    const livesByClass = await Promise.all(
      classGroups.map((classGroup) => this.liveSessionRepository.listByClass(classGroup.classId)),
    );

    return livesByClass
      .flat()
      .filter((live) => ACTIVE_STATUSES.includes(live.status))
      .sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));
  }
}
