import { describe, expect, it } from 'vitest';
import type { RawTranscriptSegment } from '@/application/ports/TranscriptionService';
import { resolveSpeakerRoles } from '@/domain/services/resolve-speaker-roles';

function segment(
  speakerLabel: string,
  startMs: number,
  endMs: number,
): RawTranscriptSegment {
  return {
    speakerLabel,
    startMs,
    endMs,
    text: 'Conteúdo fictício da aula.',
  };
}

describe('resolveSpeakerRoles', () => {
  it('assigns PROFESSOR to the greatest total duration and ALUNO to others', () => {
    const roles = resolveSpeakerRoles([
      segment('spk_0', 0, 4_000),
      segment('spk_1', 4_000, 6_000),
      segment('spk_0', 6_000, 9_000),
      segment('spk_2', 9_000, 10_000),
    ]);

    expect(roles.get('spk_0')).toBe('PROFESSOR');
    expect(roles.get('spk_1')).toBe('ALUNO');
    expect(roles.get('spk_2')).toBe('ALUNO');
  });

  it('returns an empty map for an empty segment list', () => {
    expect(resolveSpeakerRoles([]).size).toBe(0);
  });

  it('breaks equal-duration ties by alphabetical label order', () => {
    const roles = resolveSpeakerRoles([
      segment('spk_b', 0, 2_000),
      segment('spk_a', 2_000, 4_000),
    ]);

    expect(roles.get('spk_a')).toBe('PROFESSOR');
    expect(roles.get('spk_b')).toBe('ALUNO');
  });

  it('assigns PROFESSOR to a single speaker', () => {
    const roles = resolveSpeakerRoles([segment('spk_0', 0, 2_000)]);

    expect(roles.get('spk_0')).toBe('PROFESSOR');
  });
});
