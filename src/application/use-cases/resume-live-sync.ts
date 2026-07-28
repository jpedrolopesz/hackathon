import type { LiveConnectionContext } from '@/application/realtime/LiveConnectionContext';
import type { ChatMessageRepository } from '@/application/ports/ChatMessageRepository';
import type { PollRepository } from '@/application/ports/PollRepository';
import type { QuestionRepository } from '@/application/ports/QuestionRepository';
import type { ChatMessage } from '@/domain/entities/ChatMessage';
import type { Poll } from '@/domain/entities/Poll';
import type { Question } from '@/domain/entities/Question';

export interface ResumeLiveSyncInput {
  /** ISO 8601 — `createdAt` do último evento que o cliente processou antes de cair. */
  readonly since: string;
}

export interface ResumeLiveSyncResult {
  /** Mais antigas primeiro — mesma ordem de chegada que teriam tido ao vivo. */
  readonly chatMessages: readonly ChatMessage[];
  /**
   * `true` = a busca bateu no teto por shard sem alcançar `since` em algum shard —
   * pode haver mais mensagens na lacuna do que as retornadas aqui. Nunca em
   * silêncio: o cliente deve avisar o usuário que parte do histórico da lacuna não
   * foi carregada (docs/fase-1-arquitetura.md, seção 10.8).
   */
  readonly truncated: boolean;
  /** `createdAt` da mensagem mais antiga devolvida — ausente se `chatMessages` veio
   * vazio. Junto com `truncated`, dá ao cliente o que falta para decidir se tenta
   * uma busca adicional (fora do escopo desta fase) ou só avisa o usuário. */
  readonly oldestReturnedAt?: string;
  /** Snapshot completo, não um delta — perguntas e enquetes têm baixo volume, então
   * reenviar tudo é mais simples e mais correto do que tentar diferenciar "o que
   * mudou desde `since`" (um `answeredAt` novo numa pergunta antiga não apareceria
   * num filtro por `createdAt`). */
  readonly questions: readonly Question[];
  readonly polls: readonly Poll[];
}

/**
 * Conexão de WebSocket tem teto de 2h e timeout de 10min sem tráfego, nenhum dos
 * dois ajustável (docs/fase-1-arquitetura.md, seção 10.8) — reconexão no meio de uma
 * aula é esperada, não uma exceção. O cliente reconecta (novo `connectionId`, novo
 * `connectionToken` — ver `JoinLiveUseCase`) e chama `sync.resume` com o `createdAt`
 * do último evento que processou; esta é a resposta direta à conexão que perguntou,
 * nunca um broadcast.
 */
export class ResumeLiveSyncUseCase {
  constructor(
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly questionRepository: QuestionRepository,
    private readonly pollRepository: PollRepository,
  ) {}

  async execute(
    connection: LiveConnectionContext,
    input: ResumeLiveSyncInput,
  ): Promise<ResumeLiveSyncResult> {
    const [chatSince, questions, polls] = await Promise.all([
      this.chatMessageRepository.listSince(connection.liveId, input.since),
      this.questionRepository.listByLive(connection.liveId),
      this.pollRepository.listByLive(connection.liveId),
    ]);

    const oldestMessage = chatSince.messages[0];
    return {
      chatMessages: chatSince.messages,
      truncated: chatSince.truncated,
      ...(oldestMessage !== undefined ? { oldestReturnedAt: oldestMessage.createdAt } : {}),
      questions,
      polls,
    };
  }
}
