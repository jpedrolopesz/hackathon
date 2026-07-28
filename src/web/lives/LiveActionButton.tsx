'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/web/actions/lives';

/**
 * Botão genérico para uma Server Action que devolve `ActionResult` — mostra estado
 * de carregamento e erro (reagindo a `error.code`, nunca fazendo parsing de
 * `error.message`) sem repetir esse fiapo de UI em cada tela (seção 13 do README:
 * "loading e erro em toda tela").
 */
export function LiveActionButton({
  label,
  pendingLabel,
  action,
  confirmMessage,
  variant = 'default',
}: {
  label: string;
  pendingLabel: string;
  action: () => Promise<ActionResult>;
  confirmMessage?: string;
  variant?: 'default' | 'danger';
}) {
  const [state, formAction, pending] = useActionState<ActionResult>(async () => action(), {});

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (confirmMessage && !confirm(confirmMessage)) {
            event.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
            variant === 'danger'
              ? 'border border-red-600 text-red-600 dark:border-red-400 dark:text-red-400'
              : 'border border-black/10 dark:border-white/15'
          }`}
        >
          {pending ? pendingLabel : label}
        </button>
      </form>
      {state.error ? (
        <p
          role="alert"
          data-error-code={state.error.code}
          className="text-xs text-red-700 dark:text-red-300"
        >
          {state.error.message}
        </p>
      ) : null}
    </div>
  );
}
