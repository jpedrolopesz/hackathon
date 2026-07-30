import Link from 'next/link';
import { getAuthenticatedContext } from '@/web/auth/context';
import { useCases } from '@/web/container';
import { LIVE_STATUS_LABELS } from '@/web/ui/status-labels';

export default async function LivesPage() {
  const context = await getAuthenticatedContext();
  const isStudent = context.role === 'ALUNO';
  const lives = isStudent
    ? await useCases.listUpcomingLivesForStudent.execute(context)
    : await useCases.listUpcomingLivesForTeacher.execute(context);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Próximas aulas</h1>
        {!isStudent ? (
          <Link
            href="/lives/new"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Nova aula
          </Link>
        ) : null}
      </div>

      {lives.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          {isStudent
            ? 'Nenhuma aula disponível nas suas turmas.'
            : 'Nenhuma aula agendada. Crie uma aula para começar.'}
        </p>
      ) : (
        <ul className="divide-y divide-black/10 dark:divide-white/15">
          {lives.map((live) => (
            <li key={live.liveId} className="py-4">
              <Link
                href={
                  isStudent ? `/lives/${live.liveId}/classroom` : `/lives/${live.liveId}`
                }
                className="block hover:underline"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{live.title}</span>
                  <span className="text-xs text-black/60 dark:text-white/60">
                    {LIVE_STATUS_LABELS[live.status]}
                  </span>
                </div>
                <span className="text-sm text-black/60 dark:text-white/60">
                  {new Date(live.scheduledStartAt).toLocaleString('pt-BR')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
