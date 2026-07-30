import Link from 'next/link';
import { getAuthenticatedContext } from '@/web/auth/context';
import { getAccessibleLive } from '@/web/lives/get-accessible-live';
import { getEnv } from '@/shared/config/env';
import { ClassroomClient } from '@/web/studio/ClassroomClient';
import { LIVE_STATUS_LABELS } from '@/web/ui/status-labels';

export default async function ClassroomPage({
  params,
}: {
  params: Promise<{ liveId: string }>;
}) {
  const { liveId } = await params;
  const context = await getAuthenticatedContext();
  const live = await getAccessibleLive(context, liveId);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-8">
      <Link href="/lives" className="mb-4 inline-block text-sm underline">
        Voltar às aulas
      </Link>
      <h1 className="text-xl font-semibold">{live.title}</h1>
      <p className="mb-6 text-sm opacity-60">
        {LIVE_STATUS_LABELS[live.status]} —{' '}
        {new Date(live.scheduledStartAt).toLocaleString('pt-BR')}
      </p>
      {live.status === 'WAITING' || live.status === 'LIVE' ? (
        <ClassroomClient liveId={liveId} websocketUrl={getEnv().WEBSOCKET_CLIENT_URL} />
      ) : (
        <p className="rounded-md border p-4 text-sm">
          A sala ainda não foi aberta pelo professor. Atualize esta página próximo ao horário.
        </p>
      )}
    </main>
  );
}
