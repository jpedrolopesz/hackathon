import type { RawTranscriptSegment } from '@/application/ports/TranscriptionService';
import type { TranscriptSpeakerRole } from '@/domain/entities/TranscriptSegment';

/**
 * Heurística para aula expositiva: quem fala por mais tempo é PROFESSOR;
 * a alternativa é fornecer um mapeamento explícito dos participantes.
 */
export function resolveSpeakerRoles(
  segments: readonly RawTranscriptSegment[],
): ReadonlyMap<string, TranscriptSpeakerRole> {
  const durationByLabel = new Map<string, number>();

  for (const segment of segments) {
    const duration = segment.endMs - segment.startMs;
    durationByLabel.set(
      segment.speakerLabel,
      (durationByLabel.get(segment.speakerLabel) ?? 0) + duration,
    );
  }

  const labels = [...durationByLabel.keys()].sort((left, right) =>
    left.localeCompare(right),
  );

  if (labels.length === 0) {
    return new Map();
  }

  let professorLabel = labels[0]!;
  for (const label of labels.slice(1)) {
    if (durationByLabel.get(label)! > durationByLabel.get(professorLabel)!) {
      professorLabel = label;
    }
  }

  return new Map(
    labels.map((label) => [
      label,
      label === professorLabel ? 'PROFESSOR' : 'ALUNO',
    ]),
  );
}
