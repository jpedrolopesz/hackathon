import type { LiveParticipant } from '@/domain/entities/LiveParticipant';

export interface LiveParticipantRepository {
  find(liveId: string, liveParticipantId: string): Promise<LiveParticipant | null>;
  findByUser(liveId: string, userId: string): Promise<LiveParticipant | null>;
  /** Seção 13 do README — "visualizar participantes" no painel. */
  listByLive(liveId: string): Promise<readonly LiveParticipant[]>;
  save(participant: LiveParticipant): Promise<void>;
}
