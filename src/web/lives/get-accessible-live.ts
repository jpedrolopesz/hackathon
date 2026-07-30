import 'server-only';
import { notFound } from 'next/navigation';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { repositories } from '@/web/container';

/** Resolve uma live de aluno sem revelar existência entre tenants ou sem matrícula. */
export async function getAccessibleLive(
  context: AuthenticatedRequestContext,
  liveId: string,
): Promise<LiveSession> {
  const live = await repositories.liveSession.findById(liveId);
  if (!live || live.institutionId !== context.institutionId || context.role !== 'ALUNO') {
    notFound();
  }
  const enrollment = await repositories.enrollment.find(context.userId, live.classId);
  if (!enrollment || enrollment.status !== 'ACTIVE') {
    notFound();
  }
  return live;
}
