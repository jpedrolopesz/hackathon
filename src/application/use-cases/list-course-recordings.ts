import {
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { CourseRepository } from '@/application/ports/CourseRepository';
import type { RecordingPage, RecordingRepository } from '@/application/ports/RecordingRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';

export interface ListCourseRecordingsInput {
  readonly courseId: string;
  readonly pageSize: number;
  readonly cursor?: string;
}

/** `GET /courses/{courseId}/recordings` — padrão de acesso #9. Não filtra por
 * visibilidade aqui: quem lista (professor/admin da instituição) vê todas, inclusive
 * `DRAFT`/`HIDDEN` — a checagem de `visibility === PUBLISHED` é só na hora de
 * assistir (`GetRecordingPlaybackUseCase`), não na listagem administrativa. */
export class ListCourseRecordingsUseCase {
  constructor(
    private readonly recordingRepository: RecordingRepository,
    private readonly courseRepository: CourseRepository,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: ListCourseRecordingsInput,
  ): Promise<RecordingPage> {
    const course = await this.courseRepository.findById(input.courseId);
    if (!course) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `Course ${input.courseId} not found`,
      );
    }
    assertSameInstitution(context, course.institutionId);

    return this.recordingRepository.findByCourse(input.courseId, input.pageSize, input.cursor);
  }
}
