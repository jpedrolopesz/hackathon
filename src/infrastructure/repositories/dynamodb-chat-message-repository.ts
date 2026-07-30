import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  ChatMessageRepository,
  ChatMessagePage,
  ChatMessagesSinceResult,
} from '@/application/ports/ChatMessageRepository';
import type { ChatMessage } from '@/domain/entities/ChatMessage';

type ShardKey = { readonly PK: string; readonly SK: string };
type CursorMap = Record<string, ShardKey | null>;

// Teto por shard para `listSince` — pensado para a lacuna de uma reconexão (minutos),
// não para recarregar o histórico inteiro da aula (docs/fase-1-arquitetura.md, seção
// 10.8). Uma lacuna maior que isso num único shard é preenchida parcialmente e sinalizada
// via `truncated: true`. Parâmetro do construtor (não uma constante fixa) só para o
// teste de integração poder provar a truncagem sem precisar de milhares de mensagens.
export const DEFAULT_SYNC_RESUME_MAX_MESSAGES_PER_SHARD = 200;

// Retenção padrão (seção 14 do README — "política de retenção para mensagens e
// gravações") se o ambiente não informar um valor — ver
// `infrastructure/lib/config.ts` (`chatMessageRetentionDays`, por ambiente).
const DEFAULT_CHAT_MESSAGE_RETENTION_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

interface ShardQueryResult {
  readonly shard: number;
  readonly items: readonly ChatMessage[];
  readonly lastEvaluatedKey: ShardKey | undefined;
}

/**
 * Implementa o cursor composto desenhado em docs/fase-1-arquitetura.md, seção 10.2:
 * um `LastEvaluatedKey` por shard, mesclado por `createdAt` decrescente. O cursor de
 * cada shard vira a chave do ÚLTIMO ITEM DAQUELE SHARD QUE ENTROU NA PÁGINA — não o
 * `LastEvaluatedKey` que o DynamoDB devolveu — para o corte global de `pageSize`
 * funcionar mesmo quando um shard contribuiu só uma fração do que foi buscado.
 */
export class DynamoDbChatMessageRepository implements ChatMessageRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly chatShardCount: number,
    private readonly syncResumeMaxMessagesPerShard: number = DEFAULT_SYNC_RESUME_MAX_MESSAGES_PER_SHARD,
    private readonly chatMessageRetentionDays: number = DEFAULT_CHAT_MESSAGE_RETENTION_DAYS,
  ) {}

  async save(message: ChatMessage): Promise<void> {
    const ulid = extractUlid(message.messageId);
    const ttl = Math.floor(Date.now() / 1000) + this.chatMessageRetentionDays * SECONDS_PER_DAY;
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `LIVE#${message.liveId}#${message.shard}`,
          SK: `CHAT#${ulid}`,
          ttl,
          ...message,
        },
      }),
    );
  }

  async deleteById(liveId: string, messageId: string): Promise<void> {
    const shard = extractShard(messageId);
    const ulid = extractUlid(messageId);
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `LIVE#${liveId}#${shard}`, SK: `CHAT#${ulid}` },
      }),
    );
  }

  async list(liveId: string, pageSize: number, cursor?: string): Promise<ChatMessagePage> {
    const previousCursorMap: CursorMap = cursor ? decodeCursor(cursor) : {};
    const shardIndices = Array.from({ length: this.chatShardCount }, (_, index) => index);
    const activeShards = shardIndices.filter((shard) => previousCursorMap[String(shard)] !== null);

    const shardResults = await Promise.all(
      activeShards.map((shard) => this.queryShard(liveId, shard, pageSize, previousCursorMap[String(shard)])),
    );

    const candidates = shardResults.flatMap((result) =>
      result.items.map((message) => ({ shard: result.shard, message })),
    );
    candidates.sort((a, b) => (a.message.createdAt < b.message.createdAt ? 1 : -1));

    const page = candidates.slice(0, pageSize);

    const newCursorMap: CursorMap = { ...previousCursorMap };
    for (const result of shardResults) {
      const takenFromShard = page.filter((candidate) => candidate.shard === result.shard);
      if (takenFromShard.length === 0) {
        continue;
      }

      const lastTaken = takenFromShard[takenFromShard.length - 1];
      if (!lastTaken) continue;
      const allFetchedWereTaken = takenFromShard.length === result.items.length;
      const shardHasMore = Boolean(result.lastEvaluatedKey) || !allFetchedWereTaken;

      newCursorMap[String(result.shard)] = shardHasMore
        ? { PK: `LIVE#${liveId}#${result.shard}`, SK: `CHAT#${extractUlid(lastTaken.message.messageId)}` }
        : null;
    }

    const anyShardStillActive = shardIndices.some((shard) => newCursorMap[String(shard)] !== null);
    const messages = page.map((candidate) => candidate.message);

    return anyShardStillActive && messages.length > 0
      ? { messages, nextCursor: encodeCursor(newCursorMap) }
      : { messages };
  }

  async listSince(liveId: string, since: string): Promise<ChatMessagesSinceResult> {
    const shardIndices = Array.from({ length: this.chatShardCount }, (_, index) => index);
    const shardResults = await Promise.all(
      shardIndices.map(async (shard) => {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': `LIVE#${liveId}#${shard}`, ':prefix': 'CHAT#' },
            ScanIndexForward: false,
            Limit: this.syncResumeMaxMessagesPerShard,
          }),
        );
        return (result.Items ?? []).map(toChatMessage);
      }),
    );

    const messages: ChatMessage[] = [];
    let truncated = false;
    for (const items of shardResults) {
      const withinGap = items.filter((message) => message.createdAt > since);
      messages.push(...withinGap);

      // O lote bateu no teto do shard E nenhum item mais antigo que `since` apareceu
      // nele — não sabemos se existem mais mensagens além do que foi buscado. Se um
      // item <= since tivesse aparecido, saberíamos que alcançamos o fim da lacuna.
      if (items.length === this.syncResumeMaxMessagesPerShard && withinGap.length === items.length) {
        truncated = true;
      }
    }
    messages.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

    return { messages, truncated };
  }

  private async queryShard(
    liveId: string,
    shard: number,
    pageSize: number,
    exclusiveStartKey: ShardKey | null | undefined,
  ): Promise<ShardQueryResult> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LIVE#${liveId}#${shard}`, ':prefix': 'CHAT#' },
        ScanIndexForward: false,
        Limit: pageSize,
        ExclusiveStartKey: exclusiveStartKey ?? undefined,
      }),
    );

    return {
      shard,
      items: (result.Items ?? []).map(toChatMessage),
      lastEvaluatedKey: result.LastEvaluatedKey as ShardKey | undefined,
    };
  }
}

function extractShard(messageId: string): string {
  return messageId.slice(0, messageId.indexOf('#'));
}

function extractUlid(messageId: string): string {
  return messageId.slice(messageId.indexOf('#') + 1);
}

function encodeCursor(cursorMap: CursorMap): string {
  return Buffer.from(JSON.stringify(cursorMap), 'utf-8').toString('base64url');
}

function decodeCursor(cursor: string): CursorMap {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as CursorMap;
}

function toChatMessage(item: Record<string, unknown>): ChatMessage {
  return {
    messageId: item['messageId'] as string,
    liveId: item['liveId'] as string,
    shard: item['shard'] as number,
    authorLiveParticipantId: item['authorLiveParticipantId'] as string,
    authorRole: item['authorRole'] as ChatMessage['authorRole'],
    body: item['body'] as string,
    createdAt: item['createdAt'] as string,
  };
}
