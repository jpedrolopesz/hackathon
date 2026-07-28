export type PollStatus = 'OPEN' | 'CLOSED';

export interface PollOption {
  readonly optionId: string;
  readonly text: string;
}

/** Chave: PK=LIVE#{liveId}, SK=POLL#{pollId}. Opções embutidas (denormalizadas) —
 * uma enquete tem poucas opções, não justifica itens separados. */
export interface Poll {
  readonly pollId: string;
  readonly liveId: string;
  readonly question: string;
  readonly options: readonly PollOption[];
  readonly status: PollStatus;
  readonly createdAt: string;
  readonly closedAt?: string;
}
