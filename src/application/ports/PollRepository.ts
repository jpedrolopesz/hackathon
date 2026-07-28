import type { Poll } from '@/domain/entities/Poll';
import type { PollVote } from '@/domain/entities/PollVote';

export interface PollRepository {
  save(poll: Poll): Promise<void>;
  find(liveId: string, pollId: string): Promise<Poll | null>;
  /** Todas as enquetes da live (baixo volume, sem shard) — usado por `sync.resume`. */
  listByLive(liveId: string): Promise<readonly Poll[]>;
  saveVote(vote: PollVote): Promise<void>;
  listVotes(liveId: string, pollId: string): Promise<readonly PollVote[]>;
}
