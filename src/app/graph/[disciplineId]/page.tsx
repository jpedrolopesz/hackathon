import { getAuthenticatedContext } from '@/web/auth/context';
import { GraphCanvas } from '@/web/graph/GraphCanvas';
import { graphViewMock } from '@/web/graph/graph-view-mock';

export default async function GraphViewPage({
  params,
}: {
  params: Promise<{ disciplineId: string }>;
}) {
  const { disciplineId } = await params;
  await getAuthenticatedContext();

  // Na Etapa 5, os dados virão de GET /me/graph/{disciplineId}; este mock é temporário.
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 p-8">
      <h1 className="mb-6 text-xl font-semibold">
        Grafo de aprendizagem — {graphViewMock.data.discipline.name}
      </h1>
      <GraphCanvas key={disciplineId} graph={graphViewMock} />
    </main>
  );
}
