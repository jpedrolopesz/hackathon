'use client';

import { useActionState } from 'react';
import { scheduleLiveAction, type ActionResult } from '@/web/actions/lives';

export function NewLiveForm({
  classes,
}: {
  classes: readonly { classId: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (_prev, formData) => {
    const description = formData.get('description');
    return scheduleLiveAction({
      classId: String(formData.get('classId')),
      title: String(formData.get('title')),
      ...(description ? { description: String(description) } : {}),
      scheduledStartAt: new Date(String(formData.get('scheduledStartAt'))).toISOString(),
      scheduledDurationMinutes: Number(formData.get('scheduledDurationMinutes')),
    });
  }, {});

  return (
    <form action={action} className="flex max-w-md flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Turma
        <select
          name="classId"
          required
          className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15 dark:bg-transparent"
        >
          {classes.map((classGroup) => (
            <option key={classGroup.classId} value={classGroup.classId}>
              {classGroup.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Título
        <input
          name="title"
          required
          maxLength={200}
          className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15 dark:bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Descrição (opcional)
        <textarea
          name="description"
          rows={3}
          className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15 dark:bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Data e horário
        <input
          type="datetime-local"
          name="scheduledStartAt"
          required
          className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15 dark:bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Duração planejada (minutos)
        <input
          type="number"
          name="scheduledDurationMinutes"
          min={15}
          max={1440}
          defaultValue={120}
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
        {pending ? 'Criando…' : 'Criar aula'}
      </button>
    </form>
  );
}
