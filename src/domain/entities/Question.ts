export type QuestionStatus = 'OPEN' | 'ANSWERED' | 'HIGHLIGHTED';

/** Chave: PK=LIVE#{liveId}, SK=QUESTION#{createdAt}#{questionId} — sem shard, o
 * volume de perguntas é ordens de magnitude menor que chat. */
export interface Question {
  readonly questionId: string;
  readonly liveId: string;
  readonly authorLiveParticipantId: string;
  readonly body: string;
  readonly status: QuestionStatus;
  readonly createdAt: string;
  readonly answeredAt?: string;
}
