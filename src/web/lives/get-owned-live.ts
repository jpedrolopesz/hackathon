import 'server-only';
import { notFound } from 'next/navigation';
import {
  assertClassOwner,
  assertSameInstitution,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import { repositories } from '@/web/container';

/**
 * Resolve uma live e confirma que `context` pode geri-la (mesma turma/instituição —
 * `assertClassOwner`/`assertSameInstitution`, seção 17 do README). Usado por
 * qualquer página do painel que opera sobre UMA live específica (detalhe, estúdio),
 * para não duplicar a checagem em cada uma.
 */
export async function getOwnedLive(
  context: AuthenticatedRequestContext,
  liveId: string,
): Promise<LiveSession> {
  const live = await repositories.liveSession.findById(liveId);
  if (!live) {
    notFound();
  }

  try {
    assertSameInstitution(context, live.institutionId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  // Fora do try acima de propósito: `ForbiddenError` (professor de outra turma, MESMA
  // instituição) não deve virar 404 — a seção 14 do README só proíbe enumeração
  // ENTRE instituições; dentro da mesma instituição, 403 não vaza nada que o usuário
  // já não soubesse (guards.ts tem a mesma distinção). Propaga para o error boundary
  // do Next mostrar uma tela de "sem permissão".
  assertClassOwner(context, live);

  return live;
}
