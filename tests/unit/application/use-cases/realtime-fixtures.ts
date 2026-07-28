import type { AttendanceRepository } from '@/application/ports/AttendanceRepository';
import type {
  ChatMessageRepository,
  ChatMessagePage,
  ChatMessagesSinceResult,
} from '@/application/ports/ChatMessageRepository';
import type { PollRepository } from '@/application/ports/PollRepository';
import type { QuestionRepository } from '@/application/ports/QuestionRepository';
import type { RateLimiter } from '@/application/ports/RateLimiter';
import type { BroadcastResult, RealtimeBroadcaster } from '@/application/ports/RealtimeBroadcaster';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';
import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import type { Attendance } from '@/domain/entities/Attendance';
import type { ChatMessage } from '@/domain/entities/ChatMessage';
import type { Poll } from '@/domain/entities/Poll';
import type { PollVote } from '@/domain/entities/PollVote';
import type { Question } from '@/domain/entities/Question';
import type { WebSocketConnection } from '@/domain/entities/WebSocketConnection';
import type { Role } from '@/domain/value-objects/Role';

export function buildConnectionContext(
  overrides: Partial<LiveConnectionContext> = {},
): LiveConnectionContext {
  return {
    liveId: 'live-1',
    userId: 'user-1',
    liveParticipantId: 'participant-1',
    role: 'ALUNO' as Role,
    ...overrides,
  };
}

export class FakeChatMessageRepository implements ChatMessageRepository {
  readonly saved: ChatMessage[] = [];
  readonly deleted: Array<{ liveId: string; messageId: string }> = [];

  async save(message: ChatMessage): Promise<void> {
    this.saved.push(message);
  }

  async deleteById(liveId: string, messageId: string): Promise<void> {
    this.deleted.push({ liveId, messageId });
  }

  async list(): Promise<ChatMessagePage> {
    return { messages: [] };
  }

  // Fake em memória não simula o teto por shard — sempre devolve tudo, nunca trunca.
  // Truncamento real só é provado contra DynamoDB Local (teste de integração).
  async listSince(liveId: string, since: string): Promise<ChatMessagesSinceResult> {
    const messages = this.saved
      .filter((message) => message.liveId === liveId && message.createdAt > since)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    return { messages, truncated: false };
  }
}

export class FakeQuestionRepository implements QuestionRepository {
  private readonly store = new Map<string, Question>();

  private key(liveId: string, questionId: string): string {
    return `${liveId}#${questionId}`;
  }

  seed(question: Question): void {
    this.store.set(this.key(question.liveId, question.questionId), { ...question });
  }

  async save(question: Question): Promise<void> {
    this.store.set(this.key(question.liveId, question.questionId), { ...question });
  }

  async find(liveId: string, questionId: string): Promise<Question | null> {
    return this.store.get(this.key(liveId, questionId)) ?? null;
  }

  async listByLive(liveId: string): Promise<readonly Question[]> {
    return [...this.store.values()].filter((question) => question.liveId === liveId);
  }
}

export class FakePollRepository implements PollRepository {
  private readonly polls = new Map<string, Poll>();
  private readonly votes: PollVote[] = [];

  private key(liveId: string, pollId: string): string {
    return `${liveId}#${pollId}`;
  }

  seed(poll: Poll): void {
    this.polls.set(this.key(poll.liveId, poll.pollId), { ...poll });
  }

  async save(poll: Poll): Promise<void> {
    this.polls.set(this.key(poll.liveId, poll.pollId), { ...poll });
  }

  async find(liveId: string, pollId: string): Promise<Poll | null> {
    return this.polls.get(this.key(liveId, pollId)) ?? null;
  }

  async listByLive(liveId: string): Promise<readonly Poll[]> {
    return [...this.polls.values()].filter((poll) => poll.liveId === liveId);
  }

  async saveVote(vote: PollVote): Promise<void> {
    const existingIndex = this.votes.findIndex(
      (v) =>
        v.liveId === vote.liveId &&
        v.pollId === vote.pollId &&
        v.liveParticipantId === vote.liveParticipantId,
    );
    if (existingIndex >= 0) {
      this.votes[existingIndex] = vote;
    } else {
      this.votes.push(vote);
    }
  }

  async listVotes(liveId: string, pollId: string): Promise<readonly PollVote[]> {
    return this.votes.filter((vote) => vote.liveId === liveId && vote.pollId === pollId);
  }
}

export class FakeWebSocketConnectionRepository implements WebSocketConnectionRepository {
  private readonly store = new Map<string, WebSocketConnection>();

  seed(connection: WebSocketConnection): void {
    this.store.set(connection.connectionId, { ...connection });
  }

  async save(connection: WebSocketConnection): Promise<void> {
    this.store.set(connection.connectionId, { ...connection });
  }

  async findByConnectionId(connectionId: string): Promise<WebSocketConnection | null> {
    return this.store.get(connectionId) ?? null;
  }

  async removeByConnectionId(connectionId: string): Promise<void> {
    this.store.delete(connectionId);
  }

  async listByLive(liveId: string): Promise<readonly WebSocketConnection[]> {
    return [...this.store.values()].filter((connection) => connection.liveId === liveId);
  }
}

export class FakeRealtimeBroadcaster implements RealtimeBroadcaster {
  readonly sentTo: Array<{ connectionId: string; payload: unknown }> = [];
  readonly staleConnectionIds = new Set<string>();

  async send(connectionId: string, payload: unknown): Promise<BroadcastResult> {
    this.sentTo.push({ connectionId, payload });
    return this.staleConnectionIds.has(connectionId) ? 'stale' : 'sent';
  }
}

export class FakeAttendanceRepository implements AttendanceRepository {
  private readonly store = new Map<string, Attendance>();

  private key(liveId: string, liveParticipantId: string): string {
    return `${liveId}#${liveParticipantId}`;
  }

  get(liveId: string, liveParticipantId: string): Attendance | undefined {
    return this.store.get(this.key(liveId, liveParticipantId));
  }

  async markPresent(
    liveId: string,
    liveParticipantId: string,
    userId: string,
    at: string,
  ): Promise<void> {
    const existing = this.store.get(this.key(liveId, liveParticipantId));
    this.store.set(this.key(liveId, liveParticipantId), {
      liveId,
      liveParticipantId,
      userId,
      joinedAt: existing?.joinedAt ?? at,
      lastSeenAt: at,
      ...(existing?.leftAt !== undefined ? { leftAt: existing.leftAt } : {}),
    });
  }

  async markLeft(liveId: string, liveParticipantId: string, at: string): Promise<void> {
    const existing = this.store.get(this.key(liveId, liveParticipantId));
    if (!existing) return;
    this.store.set(this.key(liveId, liveParticipantId), { ...existing, leftAt: at, lastSeenAt: at });
  }

  async listByLive(liveId: string): Promise<readonly Attendance[]> {
    return [...this.store.values()].filter((attendance) => attendance.liveId === liveId);
  }
}

export class FakeRateLimiter implements RateLimiter {
  readonly calls: Array<{ key: string; limit: number; windowSeconds: number }> = [];
  private readonly deniedKeys = new Set<string>();

  denyNext(key: string): void {
    this.deniedKeys.add(key);
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    this.calls.push({ key, limit, windowSeconds });
    return !this.deniedKeys.has(key);
  }
}
