const ERROR_MESSAGES: Record<string, string> = {
  PROFILE_NOT_PROVISIONED:
    'Seu login foi feito, mas ainda não existe um perfil para você nesta plataforma. Peça para um administrador cadastrá-lo.',
  INVALID_OAUTH_STATE: 'Sua sessão de login expirou ou é inválida. Tente entrar novamente.',
  TOKEN_EXCHANGE_FAILED: 'Não foi possível concluir o login. Tente novamente.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? (ERROR_MESSAGES[error] ?? 'Não foi possível concluir o login.') : null;

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-lg border border-black/10 p-8 text-center dark:border-white/15">
        <h1 className="mb-2 text-xl font-semibold">Painel do Professor</h1>
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          Entre com sua conta institucional para gerenciar suas aulas ao vivo.
        </p>
        {message ? (
          <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {message}
          </p>
        ) : null}
        <a
          href="/api/auth/login"
          className="inline-block w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          Entrar
        </a>
      </div>
    </main>
  );
}
