'use client';

import type { Recording } from '@/domain/entities/Recording';
import { hideRecordingAction, publishRecordingAction } from '@/web/actions/recordings';
import { LiveActionButton } from '@/web/lives/LiveActionButton';

export function RecordingActions({ courseId, recording }: { courseId: string; recording: Recording }) {
  if (recording.status !== 'READY') {
    return null;
  }

  return recording.visibility === 'PUBLISHED' ? (
    <LiveActionButton
      label="Ocultar"
      pendingLabel="Ocultando…"
      variant="danger"
      action={hideRecordingAction.bind(null, courseId, recording.recordingId)}
    />
  ) : (
    <LiveActionButton
      label="Publicar"
      pendingLabel="Publicando…"
      action={publishRecordingAction.bind(null, courseId, recording.recordingId)}
    />
  );
}
