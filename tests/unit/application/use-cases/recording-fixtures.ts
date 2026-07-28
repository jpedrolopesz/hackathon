import type {
  ApplyRecordingEventResult,
  RecordingEventPatch,
  RecordingPage,
  RecordingRepository,
} from '@/application/ports/RecordingRepository';
import type {
  CloudFrontSigningServicePort,
  SignPlaybackUrlInput,
} from '@/application/ports/CloudFrontSigningServicePort';
import type { Recording } from '@/domain/entities/Recording';
import type { RecordingStatus } from '@/domain/value-objects/RecordingStatus';

export class FakeRecordingRepository implements RecordingRepository {
  private readonly store = new Map<string, Recording>();

  seed(recording: Recording): void {
    this.store.set(recording.recordingId, { ...recording });
  }

  get(recordingId: string): Recording | undefined {
    return this.store.get(recordingId);
  }

  async create(recording: Recording): Promise<void> {
    if (this.store.has(recording.recordingId)) return;
    this.store.set(recording.recordingId, { ...recording });
  }

  async findById(recordingId: string): Promise<Recording | null> {
    return this.store.get(recordingId) ?? null;
  }

  async findByCourse(courseId: string, pageSize: number): Promise<RecordingPage> {
    const recordings = [...this.store.values()]
      .filter((recording) => recording.courseId === courseId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, pageSize);
    return { recordings };
  }

  async applyEvent(
    recordingId: string,
    eventTimeIso: string,
    expectedFromStatuses: readonly RecordingStatus[],
    patch: RecordingEventPatch,
  ): Promise<ApplyRecordingEventResult> {
    const recording = this.store.get(recordingId);
    if (!recording) return 'not_found';

    const eventTimeOk =
      recording.lastEventTime === undefined || recording.lastEventTime < eventTimeIso;
    const statusOk = expectedFromStatuses.includes(recording.status);
    if (!eventTimeOk || !statusOk) {
      return 'stale';
    }

    this.store.set(recordingId, { ...recording, ...patch, lastEventTime: eventTimeIso });
    return 'applied';
  }

  async publish(recordingId: string): Promise<void> {
    const recording = this.store.get(recordingId);
    if (!recording || recording.status !== 'READY') {
      throw new Error(`Recording ${recordingId} is not READY, cannot publish`);
    }
    this.store.set(recordingId, { ...recording, visibility: 'PUBLISHED' });
  }

  async hide(recordingId: string): Promise<void> {
    const recording = this.store.get(recordingId);
    if (!recording || recording.status !== 'READY') {
      throw new Error(`Recording ${recordingId} is not READY, cannot hide`);
    }
    this.store.set(recordingId, { ...recording, status: 'HIDDEN' });
  }
}

export class FakeCloudFrontSigningService implements CloudFrontSigningServicePort {
  readonly calls: SignPlaybackUrlInput[] = [];

  async signUrl(input: SignPlaybackUrlInput): Promise<string> {
    this.calls.push(input);
    return `${input.url}?signed=1&expires=${input.expiresAt.getTime()}`;
  }
}
