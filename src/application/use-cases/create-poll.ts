import { randomUUID } from 'node:crypto';
import { assertRole } from '@/application/authorization/guards';
import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
} from '@/application/realtime/realtime-limits';
import type { PollRepository } from '@/application/ports/PollRepository';
import type { RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import { ValidationError } from '@/domain/errors/ValidationError';
import type { Poll } from '@/domain/entities/Poll';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';

export interface CreatePollInput {
  readonly question: string;
  readonly options: readonly string[];
}

export class CreatePollUseCase {
  constructor(
    private readonly pollRepository: PollRepository,
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly broadcaster: RealtimeBroadcaster,
  ) {}

  async execute(connection: LiveConnectionContext, input: CreatePollInput): Promise<Poll> {
    assertRole(connection, ['PROFESSOR', 'ADMIN']);

    const question = input.question.trim();
    if (question.length === 0 || question.length > POLL_QUESTION_MAX_LENGTH) {
      throw new ValidationError(
        `A pergunta da enquete deve ter entre 1 e ${POLL_QUESTION_MAX_LENGTH} caracteres.`,
        'POLL_QUESTION_INVALID_LENGTH',
      );
    }

    const options = input.options.map((option) => option.trim());
    if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) {
      throw new ValidationError(
        `A enquete deve ter entre ${POLL_MIN_OPTIONS} e ${POLL_MAX_OPTIONS} opções.`,
        'POLL_OPTIONS_INVALID_COUNT',
      );
    }
    if (options.some((option) => option.length === 0 || option.length > POLL_OPTION_MAX_LENGTH)) {
      throw new ValidationError(
        `Cada opção deve ter entre 1 e ${POLL_OPTION_MAX_LENGTH} caracteres.`,
        'POLL_OPTION_INVALID_LENGTH',
      );
    }

    const poll: Poll = {
      pollId: randomUUID(),
      liveId: connection.liveId,
      question,
      options: options.map((text) => ({ optionId: randomUUID(), text })),
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };
    await this.pollRepository.save(poll);

    await broadcastToLive(
      this.webSocketConnectionRepository,
      this.broadcaster,
      connection.liveId,
      buildEnvelope('poll.created', connection.liveId, poll),
    );

    return poll;
  }
}
