import { assertRole } from '@/application/authorization/guards';
import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import type { QuestionRepository } from '@/application/ports/QuestionRepository';
import type { RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { Question } from '@/domain/entities/Question';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';

export interface HighlightQuestionInput {
  readonly questionId: string;
}

/** Destacar não exige que a pergunta esteja `OPEN` — um professor pode querer destacar
 * uma pergunta já respondida para retomar o assunto em voz alta. */
export class HighlightQuestionUseCase {
  constructor(
    private readonly questionRepository: QuestionRepository,
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly broadcaster: RealtimeBroadcaster,
  ) {}

  async execute(
    connection: LiveConnectionContext,
    input: HighlightQuestionInput,
  ): Promise<Question> {
    assertRole(connection, ['PROFESSOR', 'ADMIN']);

    const question = await this.questionRepository.find(connection.liveId, input.questionId);
    if (!question) {
      throw new NotFoundError(
        'Pergunta não encontrada.',
        'QUESTION_NOT_FOUND',
        `Question ${input.questionId} not found in live ${connection.liveId}`,
      );
    }

    const highlighted: Question = { ...question, status: 'HIGHLIGHTED' };
    await this.questionRepository.save(highlighted);

    await broadcastToLive(
      this.webSocketConnectionRepository,
      this.broadcaster,
      connection.liveId,
      buildEnvelope('question.highlighted', connection.liveId, highlighted),
    );

    return highlighted;
  }
}
