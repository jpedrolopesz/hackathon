import type { LiveParticipant } from '@/domain/entities/LiveParticipant';

export interface LiveParticipantRepository {
  find(liveId: string, liveParticipantId: string): Promise<LiveParticipant | null>;
  findByUser(liveId: string, userId: string): Promise<LiveParticipant | null>;
  save(participant: LiveParticipant): Promise<void>;
}
