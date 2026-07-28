import { getAuthenticatedContext } from '@/web/auth/context';
import { repositories } from '@/web/container';
import { NewLiveForm } from '@/web/lives/NewLiveForm';

export default async function NewLivePage() {
  const context = await getAuthenticatedContext();
  const classes = await repositories.classGroup.findByTeacher(context.userId);

  if (classes.length === 0) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 p-8">
        <p className="text-sm text-black/60 dark:text-white/60">
          Você ainda não tem turmas cadastradas. Peça para um administrador criar uma
          turma para você antes de agendar uma aula.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 p-8">
      <h1 className="mb-6 text-xl font-semibold">Nova aula</h1>
      <NewLiveForm classes={classes} />
    </main>
  );
}
