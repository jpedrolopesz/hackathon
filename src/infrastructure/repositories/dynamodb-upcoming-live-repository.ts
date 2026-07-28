import 'server-only';
import { BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  UpcomingLiveRepository,
  UpcomingLiveSummary,
} from '@/application/ports/UpcomingLiveRepository';

type WriteRequest =
  | { PutRequest: { Item: Record<string, unknown> } }
  | { DeleteRequest: { Key: Record<string, unknown> } };

// Limites reais da API BatchWriteItem — não confundir com o limite de 100 itens do
// TransactWriteItems (API diferente). Não usamos TransactWriteItems aqui: as
// projeções são independentes (chave própria, reescrita sem efeito colateral) e não
// precisam de atomicidade entre itens, então BatchWriteItem (mais barato, maior
// throughput) é a escolha certa — ver docs/fase-1-arquitetura.md, seção 6, padrão #5.
// Restrições que essa escolha carrega (documentadas na seção 6, não só aqui):
// BatchWriteItem não aceita ConditionExpression — uma escrita condicional (ex.: "não
// sobrescrever versão mais nova") teria que cair para PutItem individual. O outro
// limite real da API é 16 MB por chamada; não é imposto em código porque os itens de
// projeção são pequenos e fixos (nunca chegam perto disso antes do limite de 25 itens).
const BATCH_WRITE_ITEM_LIMIT = 25;

const RETRY_BASE_DELAY_MS = 50;
const RETRY_MAX_DELAY_MS = 5_000;

function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DynamoDbUpcomingLiveRepository implements UpcomingLiveRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async listUpcomingByClass(classId: string): Promise<readonly UpcomingLiveSummary[]> {
    const now = new Date().toISOString();
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK > :now',
        ExpressionAttributeValues: { ':pk': `CLASS#${classId}`, ':now': now },
      }),
    );

    return (result.Items ?? []).map(toUpcomingLiveSummary);
  }

  async projectForStudent(studentId: string, lives: readonly UpcomingLiveSummary[]): Promise<void> {
    const requests: WriteRequest[] = lives.map((live) => ({
      PutRequest: {
        Item: {
          PK: `USER#${studentId}`,
          SK: `UPCOMING#${live.scheduledStartAt}#${live.liveId}`,
          liveId: live.liveId,
          classId: live.classId,
          title: live.title,
          scheduledStartAt: live.scheduledStartAt,
        },
      },
    }));

    await this.batchWrite(requests);
  }

  async removeForStudent(studentId: string, liveIds: readonly string[]): Promise<void> {
    // A SK completa (com scheduledStartAt) é necessária para o DeleteRequest — resolve
    // liveId -> SK lendo as projeções atuais do aluno antes de apagar.
    const existing = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${studentId}`, ':prefix': 'UPCOMING#' },
      }),
    );

    const liveIdSet = new Set(liveIds);
    const requests: WriteRequest[] = (existing.Items ?? [])
      .filter((item) => liveIdSet.has(item['liveId'] as string))
      .map((item) => ({
        DeleteRequest: { Key: { PK: item['PK'] as string, SK: item['SK'] as string } },
      }));

    await this.batchWrite(requests);
  }

  private async batchWrite(requests: readonly WriteRequest[]): Promise<void> {
    for (let offset = 0; offset < requests.length; offset += BATCH_WRITE_ITEM_LIMIT) {
      await this.sendBatchWithRetry(requests.slice(offset, offset + BATCH_WRITE_ITEM_LIMIT));
    }
  }

  private async sendBatchWithRetry(batch: readonly WriteRequest[]): Promise<void> {
    let pending: readonly WriteRequest[] = batch;
    let attempt = 0;

    // UnprocessedItems é o próprio BatchWriteItem devolvendo o que não coube no
    // throughput do momento — reenviar é o retry idempotente: reescrever a mesma
    // chave não duplica nem tem efeito colateral. Backoff exponencial (50ms, 100ms,
    // 200ms... até 5s) entre tentativas — um loop apertado aqui só piora o throttling
    // que causou o UnprocessedItems em primeiro lugar.
    while (pending.length > 0) {
      if (attempt > 0) {
        await sleep(retryDelayMs(attempt - 1));
      }

      const result = await this.client.send(
        new BatchWriteCommand({ RequestItems: { [this.tableName]: [...pending] } }),
      );

      const unprocessed = result.UnprocessedItems?.[this.tableName];
      pending = (unprocessed as WriteRequest[] | undefined) ?? [];
      attempt += 1;
    }
  }
}

function toUpcomingLiveSummary(item: Record<string, unknown>): UpcomingLiveSummary {
  return {
    liveId: item['liveId'] as string,
    classId: item['classId'] as string,
    title: item['title'] as string,
    scheduledStartAt: item['scheduledStartAt'] as string,
  };
}
