import { describe, expect, it } from 'vitest';
import { parseTranscriptionOutput } from '@/infrastructure/aws/transcribe/parse-transcription-output';

describe('parseTranscriptionOutput', () => {
  it('parses realistic audio segments and converts seconds to milliseconds', () => {
    const payload = {
      results: {
        audio_segments: [
          {
            speaker_label: 'spk_0',
            start_time: '0.00',
            end_time: '8.20',
            transcript:
              'A média resume os valores por meio de uma soma dividida pela quantidade.',
          },
          {
            speaker_label: 'spk_1',
            start_time: '8.20',
            end_time: '12.34',
            transcript: 'Qual a diferença entre média e mediana?',
          },
          {
            speaker_label: 'spk_0',
            start_time: '12.34',
            end_time: '16.905',
            transcript:
              'A mediana considera a posição central dos valores ordenados.',
          },
        ],
      },
    };

    expect(parseTranscriptionOutput(payload)).toEqual([
      {
        speakerLabel: 'spk_0',
        startMs: 0,
        endMs: 8_200,
        text: 'A média resume os valores por meio de uma soma dividida pela quantidade.',
      },
      {
        speakerLabel: 'spk_1',
        startMs: 8_200,
        endMs: 12_340,
        text: 'Qual a diferença entre média e mediana?',
      },
      {
        speakerLabel: 'spk_0',
        startMs: 12_340,
        endMs: 16_905,
        text: 'A mediana considera a posição central dos valores ordenados.',
      },
    ]);
  });

  it('returns an empty list when results is absent', () => {
    expect(parseTranscriptionOutput({})).toEqual([]);
  });

  it('returns an empty list when audio_segments is absent', () => {
    expect(parseTranscriptionOutput({ results: {} })).toEqual([]);
  });

  it('discards a segment whose transcript is blank', () => {
    expect(
      parseTranscriptionOutput({
        results: {
          audio_segments: [
            {
              speaker_label: 'spk_0',
              start_time: '0.00',
              end_time: '1.00',
              transcript: '   ',
            },
          ],
        },
      }),
    ).toEqual([]);
  });

  it('uses an empty speaker label when speaker_label is absent', () => {
    expect(
      parseTranscriptionOutput({
        results: {
          audio_segments: [
            {
              start_time: '1.00',
              end_time: '2.00',
              transcript: 'Trecho fictício sem identificação de falante.',
            },
          ],
        },
      }),
    ).toEqual([
      {
        speakerLabel: '',
        startMs: 1_000,
        endMs: 2_000,
        text: 'Trecho fictício sem identificação de falante.',
      },
    ]);
  });

  it.each(['payload inválido', null])(
    'returns an empty list for malformed payload %#',
    (payload) => {
      expect(() => parseTranscriptionOutput(payload)).not.toThrow();
      expect(parseTranscriptionOutput(payload)).toEqual([]);
    },
  );
});
