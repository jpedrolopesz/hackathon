import { createHash } from 'node:crypto';

/**
 * `shard = hash(userId) % chatShardCount` — decisão da Fase 1 (docs/fase-1-
 * arquitetura.md, seção 7, linha ~555). Hash estável (SHA-256, primeiros 4 bytes como
 * inteiro sem sinal) em vez de sorteio: a distribuição por autor é determinística e
 * reproduzível em teste, e distribui bem o volume de escrita entre partições sem
 * exigir estado (nenhuma tabela de afinidade usuário→shard).
 */
export function hashUserIdToShard(userId: string, chatShardCount: number): number {
  const digest = createHash('sha256').update(userId).digest();
  const unsignedInt32 = digest.readUInt32BE(0);
  return unsignedInt32 % chatShardCount;
}
