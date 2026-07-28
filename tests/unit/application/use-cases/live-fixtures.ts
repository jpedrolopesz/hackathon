import type {
  ConnectionTicketRepository,
  ConsumedConnectionTicket,
} from '@/application/ports/ConnectionTicketRepository';
import type {
  CreatedComposition,
  CreatedParticipantToken,
  CreatedStage,
  CreateParticipantTokenInput,
  CreateStageInput,
  DisconnectParticipantInput,
  IvsRealTimeServicePort,
  StartCompositionInput,
} from '@/application/ports/IvsRealTimeServicePort';
import type { LiveParticipantRepository } from '@/application/ports/LiveParticipantRepository';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import type { ConnectionTicket } from '@/domain/entities/ConnectionTicket';
import type { LiveParticipant } from '@/domain/entities/LiveParticipant';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { LiveStatus } from '@/domain/value-objects/LiveStatus';

export class FakeLiveSessionRepository implements LiveSessionRepository {
  private readonly store = new Map<string, LiveSession>();

  seed(live: LiveSession): void {
    this.store.set(live.liveId, { ...live });
  }

  get(liveId: string): LiveSession | undefined {
    return this.store.get(liveId);
  }

  async findById(liveId: string): Promise<LiveSession | null> {
    return this.store.get(liveId) ?? null;
  }

  async findByStageArn(stageArn: string): Promise<LiveSession | null> {
    for (const live of this.store.values()) {
      if (live.stageArn === stageArn) return live;
    }
    return null;
  }

  async create(live: LiveSession): Promise<void> {
    if (this.store.has(live.liveId)) {
      throw new ConflictError(
        'Não foi possível concluir a operação porque o estado da aula mudou. Tente novamente.',
        'CONFLICT',
        `LiveSession ${live.liveId} already exists`,
      );
    }
    this.store.set(live.liveId, { ...live });
  }

  async transitionStatus(
    liveId: string,
    expectedStatus: LiveStatus,
    nextStatus: LiveStatus,
  ): Promise<void> {
    const live = this.store.get(liveId);
    if (!live || live.status !== expectedStatus) {
      throw new ConflictError(
        'Não foi possível concluir a operação porque o estado da aula mudou. Tente novamente.',
        'CONFLICT',
        `LiveSession ${liveId} transition ${expectedStatus} -> ${nextStatus} failed: current status was not ${expectedStatus}`,
      );
    }
    this.store.set(liveId, { ...live, status: nextStatus, updatedAt: new Date().toISOString() });
  }

  async attachStage(liveId: string, expectedStatus: LiveStatus, stageArn: string): Promise<void> {
    const live = this.store.get(liveId);
    if (!live || live.status !== expectedStatus || live.stageArn !== undefined) {
      throw new ConflictError(
        'Não foi possível concluir a operação porque o estado da aula mudou. Tente novamente.',
        'CONFLICT',
        `LiveSession ${liveId} attachStage failed`,
      );
    }
    this.store.set(liveId, { ...live, stageArn, updatedAt: new Date().toISOString() });
  }

  async listByClass(classId: string): Promise<readonly LiveSession[]> {
    return [...this.store.values()].filter((live) => live.classId === classId);
  }

  async updateDetails(
    liveId: string,
    details: { readonly title: string; readonly description?: string; readonly scheduledStartAt: string },
  ): Promise<void> {
    const live = this.store.get(liveId);
    if (!live) {
      throw new ConflictError(
        'Não foi possível concluir a operação porque o estado da aula mudou. Tente novamente.',
        'CONFLICT',
        `LiveSession ${liveId} not found`,
      );
    }
    this.store.set(liveId, {
      ...live,
      title: details.title,
      ...(details.description !== undefined ? { description: details.description } : {}),
      scheduledStartAt: details.scheduledStartAt,
      updatedAt: new Date().toISOString(),
    });
  }

  async claimActiveRecording(
    liveId: string,
    expectedCurrentRecordingId: string | undefined,
    newRecordingId: string,
  ): Promise<void> {
    const live = this.store.get(liveId);
    if (!live || live.activeRecordingId !== expectedCurrentRecordingId) {
      throw new ConflictError(
        'Não foi possível concluir a operação porque o estado da aula mudou. Tente novamente.',
        'CONFLICT',
        `LiveSession ${liveId} claimActiveRecording failed`,
      );
    }
    this.store.set(liveId, {
      ...live,
      activeRecordingId: newRecordingId,
      updatedAt: new Date().toISOString(),
    });
  }

  async clearActiveRecording(liveId: string, expectedRecordingId: string): Promise<void> {
    const live = this.store.get(liveId);
    if (!live || live.activeRecordingId !== expectedRecordingId) {
      return;
    }
    const updated: LiveSession = { ...live, updatedAt: new Date().toISOString() };
    delete (updated as { activeRecordingId?: string }).activeRecordingId;
    this.store.set(liveId, updated);
  }
}

export class FakeLiveParticipantRepository implements LiveParticipantRepository {
  private readonly store = new Map<string, LiveParticipant>();

  /** Só para asserção em teste — nº de `LiveParticipant` distintos armazenados. */
  get size(): number {
    return this.store.size;
  }

  private key(liveId: string, liveParticipantId: string): string {
    return `${liveId}#${liveParticipantId}`;
  }

  seed(participant: LiveParticipant): void {
    this.store.set(this.key(participant.liveId, participant.liveParticipantId), { ...participant });
  }

  async find(liveId: string, liveParticipantId: string): Promise<LiveParticipant | null> {
    return this.store.get(this.key(liveId, liveParticipantId)) ?? null;
  }

  async findByUser(liveId: string, userId: string): Promise<LiveParticipant | null> {
    for (const participant of this.store.values()) {
      if (participant.liveId === liveId && participant.userId === userId) {
        return participant;
      }
    }
    return null;
  }

  async listByLive(liveId: string): Promise<readonly LiveParticipant[]> {
    return [...this.store.values()].filter((participant) => participant.liveId === liveId);
  }

  async save(participant: LiveParticipant): Promise<void> {
    this.store.set(this.key(participant.liveId, participant.liveParticipantId), { ...participant });
  }
}

export class FakeIvsRealTimeService implements IvsRealTimeServicePort {
  readonly createStageCalls: CreateStageInput[] = [];
  readonly deleteStageCalls: string[] = [];
  readonly createParticipantTokenCalls: CreateParticipantTokenInput[] = [];
  readonly disconnectParticipantCalls: DisconnectParticipantInput[] = [];
  readonly startCompositionCalls: StartCompositionInput[] = [];
  readonly stopCompositionCalls: string[] = [];

  throwOnCreateStage?: Error | undefined;
  stageArnToReturn = 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage';
  compositionArnToReturn = 'arn:aws:ivs:us-east-1:123456789012:composition/fake-composition';
  s3PrefixToReturn: string | undefined = 'fake-stage/session/composition';
  private participantIdCounter = 0;
  private compositionIdCounter = 0;

  async createStage(input: CreateStageInput): Promise<CreatedStage> {
    this.createStageCalls.push(input);
    if (this.throwOnCreateStage) throw this.throwOnCreateStage;
    return { stageArn: this.stageArnToReturn };
  }

  async deleteStage(stageArn: string): Promise<void> {
    this.deleteStageCalls.push(stageArn);
  }

  async createParticipantToken(
    input: CreateParticipantTokenInput,
  ): Promise<CreatedParticipantToken> {
    this.createParticipantTokenCalls.push(input);
    this.participantIdCounter += 1;
    return {
      token: `fake-token-${this.participantIdCounter}`,
      ivsParticipantId: `ivs-participant-${this.participantIdCounter}`,
      expiresAt: new Date(Date.now() + input.durationMinutes * 60_000).toISOString(),
    };
  }

  async disconnectParticipant(input: DisconnectParticipantInput): Promise<void> {
    this.disconnectParticipantCalls.push(input);
  }

  async startComposition(input: StartCompositionInput): Promise<CreatedComposition> {
    this.startCompositionCalls.push(input);
    this.compositionIdCounter += 1;
    return {
      compositionArn: `${this.compositionArnToReturn}-${this.compositionIdCounter}`,
      ...(this.s3PrefixToReturn !== undefined ? { s3Prefix: this.s3PrefixToReturn } : {}),
    };
  }

  async stopComposition(compositionArn: string): Promise<void> {
    this.stopCompositionCalls.push(compositionArn);
  }
}

export class FakeConnectionTicketRepository implements ConnectionTicketRepository {
  readonly created: ConnectionTicket[] = [];
  private readonly consumedTickets = new Set<string>();

  async create(ticket: ConnectionTicket): Promise<void> {
    this.created.push(ticket);
  }

  async consume(ticket: string): Promise<ConsumedConnectionTicket | null> {
    const found = this.created.find((candidate) => candidate.ticket === ticket);
    if (!found || this.consumedTickets.has(ticket)) {
      return null;
    }
    if (new Date(found.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    this.consumedTickets.add(ticket);
    return { liveId: found.liveId, userId: found.userId };
  }
}
