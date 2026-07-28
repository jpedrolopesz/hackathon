'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DomainError } from '@/domain/errors/DomainError';
import { getAuthenticatedContext } from '@/web/auth/context';
import { useCases } from '@/web/container';

export interface ActionResult {
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * Server Actions do painel — chamam os use-cases DIRETO (sem round-trip HTTP): são
 * Server Functions do próprio Next.js, executam no servidor, e já têm proteção
 * própria contra CSRF (mesma origem, token de ação) — não precisam do contrato
 * `/api/v1/*` (esse é para o app iOS/clientes externos, ver
 * docs/openapi.yaml). Erro NUNCA solto: sempre `{error: {code, message}}` — quem
 * renderiza o formulário decide o que fazer com `code` (nunca faz parsing de
 * `message`, que é só para exibição).
 */
function toActionError(error: unknown): ActionResult {
  if (error instanceof DomainError) {
    return { error: { code: error.code, message: error.publicMessage } };
  }
  return { error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro inesperado. Tente novamente.' } };
}

export async function scheduleLiveAction(input: {
  classId: string;
  title: string;
  description?: string;
  scheduledStartAt: string;
}): Promise<ActionResult> {
  const context = await getAuthenticatedContext();
  try {
    const live = await useCases.scheduleLive.execute(context, { liveId: randomUUID(), ...input });
    revalidatePath('/lives');
    redirect(`/lives/${live.liveId}`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateLiveAction(
  liveId: string,
  input: { title: string; description?: string; scheduledStartAt: string },
): Promise<ActionResult> {
  const context = await getAuthenticatedContext();
  try {
    await useCases.updateLive.execute(context, { liveId, ...input });
    revalidatePath(`/lives/${liveId}`);
    revalidatePath('/lives');
    return {};
  } catch (error) {
    return toActionError(error);
  }
}

export async function cancelLiveAction(liveId: string): Promise<ActionResult> {
  const context = await getAuthenticatedContext();
  try {
    await useCases.cancelLive.execute(context, liveId);
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath('/lives');
  redirect('/lives');
}

export async function startLiveAction(liveId: string): Promise<ActionResult> {
  const context = await getAuthenticatedContext();
  try {
    await useCases.startLive.execute(context, liveId);
    revalidatePath(`/lives/${liveId}`);
    return {};
  } catch (error) {
    return toActionError(error);
  }
}

export async function finishLiveAction(liveId: string): Promise<ActionResult> {
  const context = await getAuthenticatedContext();
  try {
    await useCases.finishLive.execute(context, liveId);
    revalidatePath(`/lives/${liveId}`);
  } catch (error) {
    return toActionError(error);
  }
  redirect(`/lives/${liveId}`);
}

export async function promoteParticipantAction(
  liveId: string,
  targetLiveParticipantId: string,
): Promise<ActionResult> {
  const context = await getAuthenticatedContext();
  try {
    await useCases.promoteParticipant.execute(context, { liveId, targetLiveParticipantId });
    revalidatePath(`/lives/${liveId}`);
    return {};
  } catch (error) {
    return toActionError(error);
  }
}

export async function demoteParticipantAction(
  liveId: string,
  targetLiveParticipantId: string,
): Promise<ActionResult> {
  const context = await getAuthenticatedContext();
  try {
    await useCases.demoteParticipant.execute(context, { liveId, targetLiveParticipantId });
    revalidatePath(`/lives/${liveId}`);
    return {};
  } catch (error) {
    return toActionError(error);
  }
}
