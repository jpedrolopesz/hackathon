import Link from 'next/link';
import { getAuthenticatedContext } from '@/web/auth/context';
import { repositories } from '@/web/container';
import { getOwnedLive } from '@/web/lives/get-owned-live';
import { EditLiveForm } from '@/web/lives/EditLiveForm';
import { ParticipantsList } from '@/web/lives/ParticipantsList';
import { LiveActionButton } from '@/web/lives/LiveActionButton';
import { cancelLiveAction, finishLiveAction, startLiveAction } from '@/web/actions/lives';
import { LIVE_STATUS_LABELS } from '@/web/ui/status-labels';

export default async function LiveDetailPage({
  params,
}: {
  params: Promise<{ liveId: string }>;
}) {
  const { liveId } = await params;
  const context = await getAuthenticatedContext();
  const live = await getOwnedLive(context, liveId);
  const participants =
    live.status === 'WAITING' || live.status === 'LIVE'
      ? await repositories.liveParticipant.listByLive(liveId)
      : [];

  const editable = live.status === 'DRAFT' || live.status === 'SCHEDULED';
  const canEnterStudio = live.status === 'SCHEDULED' || live.status === 'WAITING' || live.status === 'LIVE';

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{live.title}</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            {LIVE_STATUS_LABELS[live.status]} — {new Date(live.scheduledStartAt).toLocaleString('pt-BR')}
          </p>
        </div>
        {canEnterStudio ? (
          <Link
            href={`/lives/${liveId}/studio`}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Entrar no estúdio
          </Link>
        ) : null}
      </div>

      <div className="mb-8 flex flex-wrap gap-3">
        {live.status === 'WAITING' ? (
          <LiveActionButton
            label="Iniciar aula"
            pendingLabel="Iniciando…"
            action={startLiveAction.bind(null, liveId)}
          />
        ) : null}
        {live.status === 'LIVE' ? (
          <LiveActionButton
            label="Encerrar aula"
            pendingLabel="Encerrando…"
            confirmMessage="Encerrar a aula agora? Isso não pode ser desfeito."
            variant="danger"
            action={finishLiveAction.bind(null, liveId)}
          />
        ) : null}
        {editable ? (
          <LiveActionButton
            label="Cancelar aula"
            pendingLabel="Cancelando…"
            confirmMessage="Cancelar esta aula?"
            variant="danger"
            action={cancelLiveAction.bind(null, liveId)}
          />
        ) : null}
      </div>

      {editable ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold">Editar detalhes</h2>
          <EditLiveForm live={live} />
        </section>
      ) : null}

      {live.status === 'WAITING' || live.status === 'LIVE' ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Participantes</h2>
          <ParticipantsList liveId={liveId} participants={participants} />
        </section>
      ) : null}
    </main>
  );
}
