import type { LiveSession } from '@/domain/entities/LiveSession';
import {
  assertValidDurationMinutes,
  IVS_TOKEN_DURATION_MINUTES,
} from '@/infrastructure/aws/ivs/participant-token-attributes';

export const DEFAULT_LIVE_DURATION_MINUTES = 120;
export const PARTICIPANT_TOKEN_MARGIN_MINUTES = 30;

/**
 * O token cobre a duração agendada inteira mais uma margem. O teto de ambiente
 * limita a exposição em caso de vazamento; o teto absoluto continua sendo o do IVS.
 */
export function participantTokenDurationMinutes(
  live: Pick<LiveSession, 'scheduledDurationMinutes'>,
  environmentMaximumMinutes: number,
): number {
  const scheduledDuration = live.scheduledDurationMinutes ?? DEFAULT_LIVE_DURATION_MINUTES;
  const duration = Math.min(
    scheduledDuration + PARTICIPANT_TOKEN_MARGIN_MINUTES,
    environmentMaximumMinutes,
    IVS_TOKEN_DURATION_MINUTES.MAX,
  );
  assertValidDurationMinutes(duration);
  return duration;
}
