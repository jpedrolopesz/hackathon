import { assertRole } from '@/application/authorization/guards';
import { broadcastToLive } from '@/application/realtime/broadcast-to-live';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import type { PollRepository } from '@/application/ports/PollRepository';
import type { RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { Poll } from '@/domain/entities/Poll';
import { buildEnvelope } from '@/domain/value-objects/RealtimeEnvelope';

export interface ClosePollInput {
  readonly pollId: string;
}

export interface PollResult {
  readonly optionId: string;
  readonly count: number;
}

export interface ClosePollResult {
  readonly poll: Poll;
  readonly results: readonly PollResult[];
}

/** Idempotente: fechar uma enquete já fechada apenas recalcula e reenvia a apuração —
 * não é um erro, é útil se o broadcast original se perdeu. */
export class ClosePollUseCase {
  constructor(
    private readonly pollRepository: PollRepository,
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly broadcaster: RealtimeBroadcaster,
  ) {}

  async execute(connection: LiveConnectionContext, input: ClosePollInput): Promise<ClosePollResult> {
    assertRole(connection, ['PROFESSOR', 'ADMIN']);

    const poll = await this.pollRepository.find(connection.liveId, input.pollId);
    if (!poll) {
      throw new NotFoundError(
        'Enquete não encontrada.',
        'POLL_NOT_FOUND',
        `Poll ${input.pollId} not found in live ${connection.liveId}`,
      );
    }

    const closed: Poll =
      poll.status === 'CLOSED' ? poll : { ...poll, status: 'CLOSED', closedAt: new Date().toISOString() };
    if (closed !== poll) {
      await this.pollRepository.save(closed);
    }

    const votes = await this.pollRepository.listVotes(connection.liveId, input.pollId);
    const countByOption = new Map<string, number>();
    for (const option of closed.options) {
      countByOption.set(option.optionId, 0);
    }
    for (const vote of votes) {
      countByOption.set(vote.optionId, (countByOption.get(vote.optionId) ?? 0) + 1);
    }
    const results: PollResult[] = closed.options.map((option) => ({
      optionId: option.optionId,
      count: countByOption.get(option.optionId) ?? 0,
    }));

    await broadcastToLive(
      this.webSocketConnectionRepository,
      this.broadcaster,
      connection.liveId,
      buildEnvelope('poll.closed', connection.liveId, { poll: closed, results }),
    );

    return { poll: closed, results };
  }
}
