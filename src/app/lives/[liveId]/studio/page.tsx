import { getAuthenticatedContext } from '@/web/auth/context';
import { getOwnedLive } from '@/web/lives/get-owned-live';
import { ensureStageProvisioned } from '@/web/lives/ensure-stage-provisioned';
import { StudioClient } from '@/web/studio/StudioClient';
import { getEnv } from '@/shared/config/env';

export default async function StudioPage({
  params,
}: {
  params: Promise<{ liveId: string }>;
}) {
  const { liveId } = await params;
  const context = await getAuthenticatedContext();
  const live = await getOwnedLive(context, liveId);
  // Primeiro acesso ao estúdio é o gatilho documentado para provisionar o Stage
  // (docs/fase-1-arquitetura.md, seção 9/12) — não um botão separado.
  await ensureStageProvisioned(live);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-8">
      <h1 className="mb-6 text-xl font-semibold">Estúdio — {live.title}</h1>
      <StudioClient liveId={liveId} websocketUrl={getEnv().WEBSOCKET_CLIENT_URL} />
    </main>
  );
}
