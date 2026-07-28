import { describe, expect, it } from 'vitest';
import { canTransitionLiveStatus } from '@/domain/value-objects/LiveStatus';

describe('canTransitionLiveStatus', () => {
  it('allows the happy path DRAFT -> SCHEDULED -> WAITING -> LIVE -> ENDING -> ENDED', () => {
    expect(canTransitionLiveStatus('DRAFT', 'SCHEDULED')).toBe(true);
    expect(canTransitionLiveStatus('SCHEDULED', 'WAITING')).toBe(true);
    expect(canTransitionLiveStatus('WAITING', 'LIVE')).toBe(true);
    expect(canTransitionLiveStatus('LIVE', 'ENDING')).toBe(true);
    expect(canTransitionLiveStatus('ENDING', 'ENDED')).toBe(true);
  });

  it('allows cancellation before the live actually starts', () => {
    expect(canTransitionLiveStatus('DRAFT', 'CANCELED')).toBe(true);
    expect(canTransitionLiveStatus('SCHEDULED', 'CANCELED')).toBe(true);
    expect(canTransitionLiveStatus('WAITING', 'CANCELED')).toBe(true);
  });

  it('rejects skipping WAITING (SCHEDULED cannot jump straight to LIVE)', () => {
    expect(canTransitionLiveStatus('SCHEDULED', 'LIVE')).toBe(false);
  });

  it('rejects a live that already ended from transitioning anywhere (seção 10: nunca volta para LIVE)', () => {
    expect(canTransitionLiveStatus('ENDED', 'LIVE')).toBe(false);
    expect(canTransitionLiveStatus('CANCELED', 'LIVE')).toBe(false);
    expect(canTransitionLiveStatus('ENDED', 'SCHEDULED')).toBe(false);
  });

  it('rejects canceling a live that is already LIVE (seção 10: só antes de começar)', () => {
    expect(canTransitionLiveStatus('LIVE', 'CANCELED')).toBe(false);
  });
});
