import type { RawTranscriptSegment } from '@/application/ports/TranscriptionService';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAudioSegment(value: unknown): RawTranscriptSegment | null {
  if (!isRecord(value)) {
    return null;
  }

  const transcript = value['transcript'];
  const startTime = value['start_time'];
  const endTime = value['end_time'];

  if (
    typeof transcript !== 'string' ||
    transcript.trim().length === 0 ||
    typeof startTime !== 'string' ||
    typeof endTime !== 'string'
  ) {
    return null;
  }

  const startSeconds = Number(startTime);
  const endSeconds = Number(endTime);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    return null;
  }

  return {
    speakerLabel:
      typeof value['speaker_label'] === 'string'
        ? value['speaker_label']
        : '',
    startMs: Math.round(startSeconds * 1_000),
    endMs: Math.round(endSeconds * 1_000),
    text: transcript,
  };
}

export function parseTranscriptionOutput(
  payload: unknown,
): readonly RawTranscriptSegment[] {
  if (!isRecord(payload)) {
    return [];
  }

  const results = payload['results'];
  if (!isRecord(results)) {
    return [];
  }

  const audioSegments = results['audio_segments'];
  if (!Array.isArray(audioSegments)) {
    return [];
  }

  return audioSegments.flatMap((segment) => {
    const parsed = parseAudioSegment(segment);
    return parsed ? [parsed] : [];
  });
}
