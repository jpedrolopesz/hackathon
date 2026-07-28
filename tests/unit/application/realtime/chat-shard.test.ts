import { describe, expect, it } from 'vitest';
import { hashUserIdToShard } from '@/application/realtime/chat-shard';

describe('hashUserIdToShard', () => {
  it('is deterministic for the same userId', () => {
    expect(hashUserIdToShard('user-42', 16)).toBe(hashUserIdToShard('user-42', 16));
  });

  it('always stays within [0, chatShardCount)', () => {
    for (let i = 0; i < 200; i += 1) {
      const shard = hashUserIdToShard(`user-${i}`, 4);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(4);
    }
  });

  it('behaves the same with chatShardCount = 1 (always shard 0)', () => {
    expect(hashUserIdToShard('any-user', 1)).toBe(0);
  });
});
