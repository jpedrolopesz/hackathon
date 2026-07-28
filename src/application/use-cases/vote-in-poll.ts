import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import { POLL_VOTE_RATE_LIMIT } from '@/application/realtime/realtime-limits';
import type { PollRepository } from '@/application/ports/PollRepository';
import type { RateLimiter } from '@/application/ports/RateLimiter';
import type { RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import { ValidationError } from '@/domain/errors/ValidationError';
import type { PollVote } from '@/domain/entities/PollVote';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';

export interface VoteInPollInput {
  readonly pollId: string;
  readonly optionId: string;
}

/**
 * `saveVote` sobrescreve (PutItem, chave `PK+SK` sem a opção — docs/fase-1-
 * arquitetura.md, seção 6/10.4) — votar de novo troca de opção, não conta dois votos.
 * O broadcast leva o voto bruto, não uma tally agregada: agregação fica para
 * `ClosePollUseCase`, que já precisa ler todos os votos para fechar a enquete.
 */
export class VoteInPollUseCase {
  constructor(
    private readonly pollRepository: PollRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly broadcaster: RealtimeBroadcaster,
  ) {}

  async execute(connection: LiveConnectionContext, input: VoteInPollInput): Promise<PollVote> {
    const poll = await this.pollRepository.find(connection.liveId, input.pollId);
    if (!poll) {
      throw new NotFoundError(
        'Enquete não encontrada.',
        'POLL_NOT_FOUND',
        `Poll ${input.pollId} not found in live ${connection.liveId}`,
      );
    }
    if (poll.status !== 'OPEN') {
      throw new ConflictError('Esta enquete já foi encerrada.', 'POLL_CLOSED');
    }
    if (!poll.options.some((option) => option.optionId === input.optionId)) {
      throw new ValidationError('Opção inválida.', 'POLL_OPTION_NOT_FOUND');
    }

    const allowed = await this.rateLimiter.consume(
      `POLLVOTE#${connection.liveId}#${connection.userId}`,
      POLL_VOTE_RATE_LIMIT.limit,
      POLL_VOTE_RATE_LIMIT.windowSeconds,
    );
    if (!allowed) {
      throw new ConflictError(
        'Você está votando rápido demais. Aguarde um pouco.',
        'RATE_LIMIT_EXCEEDED',
      );
    }

    const vote: PollVote = {
      pollId: input.pollId,
      liveId: connection.liveId,
      liveParticipantId: connection.liveParticipantId,
      optionId: input.optionId,
      votedAt: new Date().toISOString(),
    };
    await this.pollRepository.saveVote(vote);

    await broadcastToLive(
      this.webSocketConnectionRepository,
      this.broadcaster,
      connection.liveId,
      buildEnvelope('poll.vote.recorded', connection.liveId, {
        pollId: vote.pollId,
        optionId: vote.optionId,
        liveParticipantId: vote.liveParticipantId,
      }),
    );

    return vote;
  }
}
