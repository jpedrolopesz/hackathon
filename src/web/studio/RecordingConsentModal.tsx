'use client';

export interface RecordingConsentModalProps {
  readonly open: boolean;
  readonly purposes: readonly string[];
  readonly onConsent: () => void;
  readonly onDecline: () => void;
}

export function RecordingConsentModal({
  open,
  purposes,
  onConsent,
  onDecline,
}: RecordingConsentModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
    >
      <section
        aria-describedby="recording-consent-description"
        aria-labelledby="recording-consent-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg bg-white p-6 text-black shadow-xl dark:bg-zinc-950 dark:text-white"
        role="dialog"
      >
        <h2 id="recording-consent-title" className="text-lg font-semibold">
          Gravação e processamento desta aula
        </h2>

        <div id="recording-consent-description" className="mt-3 space-y-3 text-sm">
          <p>
            Com seu consentimento, sua fala e sua imagem poderão ser capturadas durante esta aula
            e incluídas na gravação.
          </p>
          <p>
            A gravação poderá ser processada somente para as finalidades autorizadas apresentadas
            abaixo:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {purposes.map((purpose) => (
              <li key={purpose}>{purpose}</li>
            ))}
          </ul>
          <p>
            O consentimento possui escopo e vigência definidos para esta aula e pode ser revogado.
            A recusa não impede sua permanência: a sala continua acessível sem captura da sua fala.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
            onClick={onDecline}
            type="button"
          >
            Recusar e continuar na aula
          </button>
          <button
            className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
            onClick={onConsent}
            type="button"
          >
            Consentir
          </button>
        </div>
      </section>
    </div>
  );
}
