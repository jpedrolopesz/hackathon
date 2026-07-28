import { getAuthenticatedContext } from '@/web/auth/context';
import { useCases } from '@/web/container';
import { RecordingActions } from '@/web/recordings/RecordingActions';
import { RECORDING_STATUS_LABELS } from '@/web/ui/status-labels';
import type { Recording } from '@/domain/entities/Recording';

const WATCH_ERROR_MESSAGES: Record<string, string> = {
  RESOURCE_NOT_FOUND: 'Gravação não encontrada.',
  RECORDING_NOT_AVAILABLE: 'Esta gravação ainda não está disponível para assistir.',
  CLASS_NOT_OWNED: 'Você não tem permissão para assistir a esta gravação.',
};

export default async function CourseRecordingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ watchError?: string }>;
}) {
  const { courseId } = await params;
  const { watchError } = await searchParams;
  const context = await getAuthenticatedContext();
  const page = await useCases.listCourseRecordings.execute(context, { courseId, pageSize: 100 });

  // Seção 13 do README, ponto de revisão: auto-shutdown de 60s fragmenta uma aula em
  // VÁRIAS gravações (mesmo `liveId`, `recordingId`s diferentes) — agrupadas aqui
  // para não parecerem aulas desconexas.
  const groupedByLive = new Map<string, Recording[]>();
  for (const recording of page.recordings) {
    const group = groupedByLive.get(recording.liveId) ?? [];
    group.push(recording);
    groupedByLive.set(recording.liveId, group);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-8">
      <h1 className="mb-6 text-xl font-semibold">Gravações</h1>

      {watchError ? (
        <p
          role="alert"
          data-error-code={watchError}
          className="mb-6 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {WATCH_ERROR_MESSAGES[watchError] ?? 'Não foi possível reproduzir esta gravação.'}
        </p>
      ) : null}

      {groupedByLive.size === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">Nenhuma gravação ainda.</p>
      ) : (
        <div className="space-y-8">
          {[...groupedByLive.entries()].map(([liveId, recordings]) => (
            <section key={liveId}>
              {recordings.length > 1 ? (
                <h2 className="mb-2 text-sm font-semibold text-black/60 dark:text-white/60">
                  Aula com {recordings.length} partes (queda de conexão do professor)
                </h2>
              ) : null}
              <ul className="divide-y divide-black/10 dark:divide-white/15">
                {recordings.map((recording, index) => (
                  <li
                    key={recording.recordingId}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {recordings.length > 1 ? `Parte ${index + 1}` : 'Gravação'} —{' '}
                        {new Date(recording.startedAt).toLocaleString('pt-BR')}
                      </p>
                      <p className="text-xs text-black/60 dark:text-white/60">
                        {RECORDING_STATUS_LABELS[recording.status]}
                        {recording.visibility === 'PUBLISHED' ? ' · Publicada' : ' · Não publicada'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {recording.status === 'READY' && recording.visibility === 'PUBLISHED' ? (
                        <a
                          href={`/watch/${recording.recordingId}`}
                          className="rounded-md border border-black/10 px-3 py-1.5 text-sm dark:border-white/15"
                        >
                          Assistir
                        </a>
                      ) : null}
                      <RecordingActions courseId={courseId} recording={recording} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
