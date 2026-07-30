import type {
  Transcript,
  TranscriptStatus,
} from '@/domain/entities/Transcript';
import type { TranscriptSegment } from '@/domain/entities/TranscriptSegment';

export interface TranscriptRepository {
  // Garante idempotência: um recording.ready repetido não inicia um segundo job.
  findByRecordingId(
    institutionId: string,
    recordingId: string,
  ): Promise<Transcript | null>;
  save(transcript: Transcript): Promise<void>;
  saveSegments(segments: readonly TranscriptSegment[]): Promise<void>;
  // Um Transcript por gravação: a chave single-table é ancorada em recordingId.
  updateStatus(
    institutionId: string,
    recordingId: string,
    status: TranscriptStatus,
    failureReason?: string,
  ): Promise<void>;
}
