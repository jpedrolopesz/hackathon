'use client';

import { useActionState } from 'react';
import { updateLiveAction, type ActionResult } from '@/web/actions/lives';
import type { LiveSession } from '@/domain/entities/LiveSession';

export function EditLiveForm({ live }: { live: LiveSession }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (_prev, formData) => {
    const description = formData.get('description');
    return updateLiveAction(live.liveId, {
      title: String(formData.get('title')),
      ...(description ? { description: String(description) } : {}),
      scheduledStartAt: new Date(String(formData.get('scheduledStartAt'))).toISOString(),
    });
  }, {});

  return (
    <form action={action} className="flex max-w-md flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Título
        <input
          name="title"
          defaultValue={live.title}
          required
          maxLength={200}
          className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15 dark:bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Descrição (opcional)
        <textarea
          name="description"
          defaultValue={live.description}
          rows={3}
          className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15 dark:bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Data e horário
        <input
          type="datetime-local"
          name="scheduledStartAt"
          defaultValue={toLocalInputValue(live.scheduledStartAt)}
          required
          className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15 dark:bg-transparent"
        />
      </label>

      {state.error ? (
        <p
          role="alert"
          data-error-code={state.error.code}
          className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? 'Salvando…' : 'Salvar alterações'}
      </button>
    </form>
  );
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}
