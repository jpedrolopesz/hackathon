import type { Attendance } from '@/domain/entities/Attendance';

export interface AttendanceRepository {
  /** Idempotente: cria na primeira chamada (`joinedAt`), só atualiza `lastSeenAt` nas
   * seguintes — nunca duplica nem reseta `joinedAt` numa reconexão. */
  markPresent(liveId: string, liveParticipantId: string, userId: string, at: string): Promise<void>;
  /** Idempotente/best-effort: não lança se o registro não existir (desconexão sem um
   * `markPresent` prévio, cenário de borda, não deve quebrar o fluxo de `$disconnect`). */
  markLeft(liveId: string, liveParticipantId: string, at: string): Promise<void>;
  listByLive(liveId: string): Promise<readonly Attendance[]>;
}
