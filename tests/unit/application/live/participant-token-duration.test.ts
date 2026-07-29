import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_DURATION_MINUTES,
  participantTokenDurationMinutes,
} from '@/application/live/participant-token-duration';

describe('participantTokenDurationMinutes', () => {
  it('covers the scheduled duration plus the 30-minute margin', () => {
    expect(
      participantTokenDurationMinutes({ scheduledDurationMinutes: 200 }, 720),
    ).toBe(230);
  });

  it('uses the environment ceiling', () => {
    expect(
      participantTokenDurationMinutes({ scheduledDurationMinutes: 900 }, 720),
    ).toBe(720);
  });

  it('uses the backwards-compatible scheduled-duration default', () => {
    expect(participantTokenDurationMinutes({}, 720)).toBe(
      DEFAULT_LIVE_DURATION_MINUTES + 30,
    );
  });
});
