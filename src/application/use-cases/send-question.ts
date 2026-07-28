import { randomUUID } from 'node:crypto';
import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import { QUESTION_MAX_LENGTH, QUESTION_RATE_LIMIT } from '@/application/realtime/realtime-limits';
import type { QuestionRepository } from '@/application/ports/QuestionRepository';
import type { RateLimiter } from '@/application/ports/RateLimiter';
import type { RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { ValidationError } from '@/domain/errors/ValidationError';
import type { Question } from '@/domain/entities/Question';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';

export interface SendQuestionInput {
  readonly body: string;
}

export class SendQuestionUseCase {
  constructor(
    private readonly questionRepository: QuestionRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly broadcaster: RealtimeBroadcaster,
  ) {}

  async execute(connection: LiveConnectionContext, input: SendQuestionInput): Promise<Question> {
    const body = input.body.trim();
    if (body.length === 0 || body.length > QUESTION_MAX_LENGTH) {
      throw new ValidationError(
        `A pergunta deve ter entre 1 e ${QUESTION_MAX_LENGTH} caracteres.`,
        'MESSAGE_INVALID_LENGTH',
      );
    }

    const allowed = await this.rateLimiter.consume(
      `QUESTION#${connection.liveId}#${connection.userId}`,
      QUESTION_RATE_LIMIT.limit,
      QUESTION_RATE_LIMIT.windowSeconds,
    );
    if (!allowed) {
      throw new ConflictError(
        'Você está enviando perguntas rápido demais. Aguarde um pouco.',
        'RATE_LIMIT_EXCEEDED',
      );
    }

    const question: Question = {
      questionId: randomUUID(),
      liveId: connection.liveId,
      authorLiveParticipantId: connection.liveParticipantId,
      body,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };
    await this.questionRepository.save(question);

    await broadcastToLive(
      this.webSocketConnectionRepository,
      this.broadcaster,
      connection.liveId,
      buildEnvelope('question.created', connection.liveId, question),
    );

    return question;
  }
}
