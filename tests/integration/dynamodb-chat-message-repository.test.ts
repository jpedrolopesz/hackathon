import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { DynamoDbChatMessageRepository } from '@/infrastructure/repositories/dynamodb-chat-message-repository';
import type { ChatMessage } from '@/domain/entities/ChatMessage';
import { launchDynamoDbLocal, stopDynamoDbLocal } from './support/dynamodb-local';

// Porta própria — pode rodar em paralelo com os outros testes de integração.
const PORT = 8202;
const TABLE_NAME = 'test-core-table-chat-message';
const CHAT_SHARD_COUNT = 3;
const LIVE_ID = 'live-int-chat';

let rawClient: DynamoDBClient;
let repository: DynamoDbChatMessageRepository;

function buildMessage(index: number, shard: number): ChatMessage {
  // `createdAt` cresce estritamente com `index` — é o campo usado no merge entre
  // shards (docs/fase-1-arquitetura.md, seção 10.2), então isso torna a ordem
  // esperada 100% determinística independente de timing real do ULID.
  const createdAt = new Date(2026, 0, 1, 0, 0, index).toISOString();
  return {
    messageId: `${shard}#${ulid()}`,
    liveId: LIVE_ID,
    shard,
    authorLiveParticipantId: `participant-${index % 5}`,
    authorRole: 'ALUNO',
    body: `mensagem ${index}`,
    createdAt,
  };
}

beforeAll(async () => {
  rawClient = await launchDynamoDbLocal(PORT);

  await rawClient.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    }),
  );

  repository = new DynamoDbChatMessageRepository(
    DynamoDBDocumentClient.from(rawClient),
    TABLE_NAME,
    CHAT_SHARD_COUNT,
  );
}, 30_000);

afterAll(async () => {
  await rawClient.send(new DeleteTableCommand({ TableName: TABLE_NAME })).catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

async function fetchAllPages(pageSize: number): Promise<ChatMessage[]> {
  const collected: ChatMessage[] = [];
  let cursor: string | undefined;

  do {
    const page = await repository.list(LIVE_ID, pageSize, cursor);
    collected.push(...page.messages);
    cursor = page.nextCursor;
  } while (cursor);

  return collected;
}

describe('DynamoDbChatMessageRepository — cursor composto do chat sharded contra DynamoDB Local', () => {
  it('pagina 25 mensagens espalhadas em 3 shards, mais recente primeiro, sem perder nem duplicar nenhuma', async () => {
    const totalMessages = 25;
    const seeded: ChatMessage[] = [];
    for (let index = 0; index < totalMessages; index += 1) {
      const shard = index % CHAT_SHARD_COUNT;
      const message = buildMessage(index, shard);
      seeded.push(message);
      await repository.save(message);
    }

    // pageSize propositalmente não-divisor de 25 e não-múltiplo de CHAT_SHARD_COUNT —
    // força shards a contribuírem quantidades desiguais para a mesma página.
    const collected = await fetchAllPages(7);

    expect(collected).toHaveLength(totalMessages);

    const collectedIds = collected.map((message) => message.messageId);
    expect(new Set(collectedIds).size).toBe(totalMessages); // sem duplicatas

    const expectedOrder = [...seeded]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((message) => message.messageId);
    expect(collectedIds).toEqual(expectedOrder); // mais recente primeiro, sem furos
  });

  it('deleteById extrai o shard do messageId (sem Query) e remove a mensagem definitivamente', async () => {
    const message = buildMessage(1000, 1);
    await repository.save(message);

    await repository.deleteById(LIVE_ID, message.messageId);

    const collected = await fetchAllPages(50);
    expect(collected.map((item) => item.messageId)).not.toContain(message.messageId);
  });

  it('uma página isolada (sem esgotar todos os shards) devolve nextCursor para continuar depois', async () => {
    const liveId = 'live-int-chat-partial';
    for (let index = 0; index < 10; index += 1) {
      const shard = index % CHAT_SHARD_COUNT;
      await repository.save({ ...buildMessage(index, shard), liveId });
    }

    const firstPage = await repository.list(liveId, 4);
    expect(firstPage.messages).toHaveLength(4);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await repository.list(liveId, 4, firstPage.nextCursor);
    const firstIds = new Set(firstPage.messages.map((m) => m.messageId));
    const secondIds = secondPage.messages.map((m) => m.messageId);
    for (const id of secondIds) {
      expect(firstIds.has(id)).toBe(false); // segunda página nunca repete item da primeira
    }
  });

  describe('listSince — flag de truncamento (ponto de revisão: nunca truncar em silêncio)', () => {
    // Teto propositalmente pequeno (não os 200 de produção) para o teste ficar
    // rápido e determinístico — mesma tabela, repositório diferente.
    const SMALL_CAP = 3;
    let truncationRepository: DynamoDbChatMessageRepository;

    beforeAll(() => {
      // `rawClient` só existe depois do `beforeAll` do describe externo — não dá
      // para construir isto no corpo do `describe` (roda na coleta, antes de tudo).
      truncationRepository = new DynamoDbChatMessageRepository(
        DynamoDBDocumentClient.from(rawClient),
        TABLE_NAME,
        CHAT_SHARD_COUNT,
        SMALL_CAP,
      );
    });

    it('truncated: true quando a lacuna do shard é maior que o teto', async () => {
      const liveId = 'live-int-chat-truncated';
      // Um único shard (0) recebe mais mensagens que SMALL_CAP, todas dentro da lacuna.
      for (let index = 0; index < SMALL_CAP + 2; index += 1) {
        await truncationRepository.save({ ...buildMessage(index, 0), liveId });
      }

      const result = await truncationRepository.listSince(liveId, '2020-01-01T00:00:00.000Z');

      expect(result.truncated).toBe(true);
      expect(result.messages.length).toBeLessThan(SMALL_CAP + 2);
    });

    it('truncated: false quando a lacuna cabe inteira dentro do teto', async () => {
      const liveId = 'live-int-chat-not-truncated';
      for (let index = 0; index < SMALL_CAP - 1; index += 1) {
        await truncationRepository.save({ ...buildMessage(index, 0), liveId });
      }

      const result = await truncationRepository.listSince(liveId, '2020-01-01T00:00:00.000Z');

      expect(result.truncated).toBe(false);
      expect(result.messages).toHaveLength(SMALL_CAP - 1);
    });

    it('truncated: false quando o próprio `since` já está dentro do lote buscado (achamos o fim da lacuna)', async () => {
      const liveId = 'live-int-chat-since-within-batch';
      for (let index = 0; index < SMALL_CAP; index += 1) {
        await truncationRepository.save({ ...buildMessage(index, 0), liveId });
      }
      // `since` no meio das mensagens salvas — o lote buscado (Limit=SMALL_CAP)
      // inclui itens <= since, então sabemos que alcançamos o fim da lacuna.
      const since = new Date(2026, 0, 1, 0, 0, 0).toISOString();

      const result = await truncationRepository.listSince(liveId, since);

      expect(result.truncated).toBe(false);
    });
  });
});
