'use server';

import { revalidatePath } from 'next/cache';
import { DomainError } from '@/domain/errors/DomainError';
import { getAuthenticatedContext } from '@/web/auth/context';
import { useCases } from '@/web/container';
import type { ActionResult } from './lives';

function toActionError(error: unknown): ActionResult {
  if (error instanceof DomainError) {
    return { error: { code: error.code, message: error.publicMessage } };
  }
  return { error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro inesperado. Tente novamente.' } };
}

export async function publishRecordingAction(
  courseId: string,
  recordingId: string,
): Promise<ActionResult> {
  const context = await getAuthenticatedContext();
  try {
    await useCases.publishRecording.execute(context, { recordingId });
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath(`/courses/${courseId}/recordings`);
  return {};
}

export async function hideRecordingAction(
  courseId: string,
  recordingId: string,
): Promise<ActionResult> {
  const context = await getAuthenticatedContext();
  try {
    await useCases.hideRecording.execute(context, { recordingId });
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath(`/courses/${courseId}/recordings`);
  return {};
}
