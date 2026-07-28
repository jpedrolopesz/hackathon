/**
 * Chave: PK=LIVE#{liveId}, SK=ATTENDANCE#{liveParticipantId} (padrão de acesso #12).
 * Chaveada por `liveParticipantId`, nunca por `connectionId` — uma reconexão de
 * WebSocket cria um `WebSocketConnection` novo, mas reusa o mesmo `LiveParticipant`
 * (docs/fase-1-arquitetura.md, seção 10.8); contar por `connectionId` transformaria
 * um aluno que reconectou duas vezes em dois ou três participantes.
 */
export interface Attendance {
  readonly liveId: string;
  readonly liveParticipantId: string;
  readonly userId: string;
  /** Primeira conexão — nunca sobrescrita em reconexões subsequentes. */
  readonly joinedAt: string;
  /** Atualizado a cada connect/disconnect — última vez que houve atividade. */
  readonly lastSeenAt: string;
  /** Ausente enquanto ainda conectado; setado no `$disconnect` mais recente. Uma
   * reconexão posterior não limpa este campo — ele só reflete a ÚLTIMA desconexão
   * conhecida, não "está conectado agora" (isso é o que `WebSocketConnectionRepository`
   * já responde, via padrão #11). */
  readonly leftAt?: string;
}
