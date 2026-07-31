import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { assertSameInstitution } from '@/application/authorization/guards';
import type { GraphViewRepository } from '@/application/ports/GraphViewRepository';
import type {
  GraphViewEdge,
  GraphViewEnvelope,
  GraphViewNode,
} from '@/application/read-models/graph-view-contract';
import { NotFoundError } from '@/domain/errors/NotFoundError';

export type GraphViewEnvelopeData = GraphViewEnvelope['data'];

export interface GetMyGraphInput {
  readonly disciplineId: string;
}

const NO_EVIDENCE_EXPLANATION =
  'Ainda não há evidência registrada para este conceito.';

export class GetMyGraphUseCase {
  constructor(private readonly graphViewRepository: GraphViewRepository) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: GetMyGraphInput,
  ): Promise<GraphViewEnvelopeData> {
    const institutional =
      await this.graphViewRepository.findInstitutionalGraph(
        context.institutionId,
        input.disciplineId,
      );

    if (!institutional.discipline) {
      throw new NotFoundError(
        'Disciplina não encontrada.',
        'GRAPH_DISCIPLINE_NOT_FOUND',
      );
    }
    assertSameInstitution(context, institutional.discipline.institutionId);

    const overlay = await this.graphViewRepository.findUserOverlay(
      context.institutionId,
      context.userId,
      input.disciplineId,
    );
    const stateByConcept = new Map(
      overlay.states.map((state) => [state.conceptId, state]),
    );

    const institutionalNodes: GraphViewNode[] = institutional.nodes.map(
      (node) => {
        if (node.type === 'CONCEPT') {
          const learningState = stateByConcept.get(node.nodeId);
          return {
            id: node.nodeId,
            type: 'CONCEPT',
            title: node.title,
            description: node.description,
            learningState: learningState?.state ?? 'NOT_STARTED',
            explanation:
              learningState?.explanation ?? NO_EVIDENCE_EXPLANATION,
          };
        }
        if (node.type === 'MODULE') {
          return {
            id: node.nodeId,
            type: 'MODULE',
            title: node.title,
            description: node.description,
          };
        }
        return {
          id: node.nodeId,
          type: 'MATERIAL',
          title: node.title,
          materialType: node.materialType,
          sourceRef: node.sourceRef,
        };
      },
    );

    const doubtNodes: GraphViewNode[] = overlay.detectedQuestions.map(
      (question) => ({
        id: question.id,
        type: 'DOUBT',
        summary: question.summary,
        createdAt: question.detectedAt,
      }),
    );
    const questionIds = new Set(
      overlay.detectedQuestions.map((question) => question.id),
    );
    const institutionalEdges: GraphViewEdge[] = institutional.edges.map(
      (edge) => ({
        id: edge.id,
        type: edge.type,
        source: edge.fromNodeId,
        target: edge.toNodeId,
        evidenceKind: 'OBSERVED',
        style: 'SOLID',
      }),
    );
    const doubtEdges: GraphViewEdge[] = overlay.transcriptEvidences.flatMap(
      (evidence) => {
        if (
          evidence.origin !== 'TRANSCRIPT' ||
          !questionIds.has(evidence.sourceRef)
        ) {
          return [];
        }
        return [
          {
            id: `edge-doubt-about-${evidence.sourceRef}-${evidence.conceptId}`,
            type: 'DOUBT_ABOUT',
            source: evidence.sourceRef,
            target: evidence.conceptId,
            evidenceKind: 'INFERRED',
            style: 'DASHED',
          },
        ];
      },
    );

    return {
      discipline: {
        id: institutional.discipline.id,
        name: institutional.discipline.name,
        semester: institutional.discipline.semester,
      },
      nodes: [...institutionalNodes, ...doubtNodes],
      edges: [...institutionalEdges, ...doubtEdges],
    };
  }
}
