/** Chave: PK=LIVE#{liveId}, SK=POLLVOTE#{pollId}#{liveParticipantId} — uma escrita
 * por (enquete, participante) garante 1 voto por pessoa (PutItem sobrescreve para
 * trocar de opção; ver dynamodb-poll-repository.ts). */
export interface PollVote {
  readonly pollId: string;
  readonly liveId: string;
  readonly liveParticipantId: string;
  readonly optionId: string;
  readonly votedAt: string;
}
