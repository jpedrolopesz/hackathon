import type { AttendanceRepository } from '@/application/ports/AttendanceRepository';
import type { WebSocketConnectionRepository } from '@/application/ports/WebSocketConnectionRepository';

/**
 * Sem checagem de autorização: `$disconnect` do API Gateway não passa pelo authorizer
 * (só `$connect` passa) e pode disparar mesmo para conexões que nunca terminaram de
 * autenticar. `removeByConnectionId` é idempotente (no-op se a conexão não existir),
 * então chamar isso "às cegas" é seguro.
 */
export class DisconnectFromLiveUseCase {
  constructor(
    private readonly webSocketConnectionRepository: WebSocketConnectionRepository,
    private readonly attendanceRepository: AttendanceRepository,
  ) {}

  async execute(connectionId: string): Promise<void> {
    const connection = await this.webSocketConnectionRepository.findByConnectionId(connectionId);
    if (connection) {
      // Presença (padrão #12) — marca a última desconexão conhecida, chaveada por
      // liveParticipantId (nunca connectionId); best-effort, não bloqueia o
      // encerramento da conexão se falhar.
      await this.attendanceRepository.markLeft(
        connection.liveId,
        connection.liveParticipantId,
        new Date().toISOString(),
      );
    }
    await this.webSocketConnectionRepository.removeByConnectionId(connectionId);
  }
}
