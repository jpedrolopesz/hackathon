import type { LearningStateValue } from '@/domain/entities/LearningState';
import type { GraphViewNode } from '@/web/graph/graph-view-contract';

interface LearningStatePresentation {
  readonly color: string;
  readonly label: string;
}

export const LEARNING_STATE_PRESENTATION: Readonly<
  Record<LearningStateValue, LearningStatePresentation>
> = {
  NOT_STARTED: { color: '#64748B', label: 'Não iniciado' },
  BLOCKED: { color: '#7F1D1D', label: 'Bloqueado por pré-requisito' },
  IN_PROGRESS: { color: '#1D4ED8', label: 'Em progresso' },
  NEEDS_PRACTICE: { color: '#B45309', label: 'Precisa de prática' },
  POSSIBLE_DIFFICULTY: {
    color: '#A21CAF',
    label: 'Possível dificuldade no conceito',
  },
  NEEDS_REVIEW: { color: '#6D28D9', label: 'Precisa de revisão' },
  LIKELY_UNDERSTOOD: {
    color: '#15803D',
    label: 'Provavelmente compreendido',
  },
};

export const STATELESS_NODE_COLORS = {
  MODULE: '#111827',
  MATERIAL: '#0891B2',
  DOUBT: '#E11D48',
} as const satisfies Record<Exclude<GraphViewNode['type'], 'CONCEPT'>, string>;

const STATE_ENTRIES = Object.entries(LEARNING_STATE_PRESENTATION) as [
  LearningStateValue,
  LearningStatePresentation,
][];

const STATELESS_NODE_ENTRIES = [
  { color: STATELESS_NODE_COLORS.MODULE, label: 'Módulo' },
  { color: STATELESS_NODE_COLORS.MATERIAL, label: 'Material' },
  { color: STATELESS_NODE_COLORS.DOUBT, label: 'Dúvida' },
] as const;

const swatchStyle = (color: string) => ({
  backgroundColor: color,
  border: '1px solid rgba(255, 255, 255, 0.85)',
  borderRadius: '50%',
  boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.85)',
  display: 'inline-block',
  height: 12,
  width: 12,
});

export function GraphLegend() {
  return (
    <aside
      aria-label="Legenda do grafo"
      style={{
        border: '1px solid currentColor',
        borderRadius: 8,
        display: 'grid',
        gap: 16,
        padding: 16,
      }}
    >
      <section aria-labelledby="learning-state-legend">
        <h2 id="learning-state-legend" style={{ fontWeight: 600 }}>
          Estado do conceito
        </h2>
        <ul style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {STATE_ENTRIES.map(([state, presentation]) => (
            <li
              key={state}
              style={{ alignItems: 'center', display: 'flex', gap: 8 }}
            >
              <span aria-hidden="true" style={swatchStyle(presentation.color)} />
              <span>{presentation.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="node-type-legend">
        <h2 id="node-type-legend" style={{ fontWeight: 600 }}>
          Outros tipos de nó
        </h2>
        <ul style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {STATELESS_NODE_ENTRIES.map(({ color, label }) => (
            <li
              key={label}
              style={{ alignItems: 'center', display: 'flex', gap: 8 }}
            >
              <span aria-hidden="true" style={swatchStyle(color)} />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="edge-style-legend">
        <h2 id="edge-style-legend" style={{ fontWeight: 600 }}>
          Relações
        </h2>
        <ul style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <li style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
            <svg aria-hidden="true" height="8" width="40">
              <line
                stroke="currentColor"
                strokeWidth="2"
                x1="0"
                x2="40"
                y1="4"
                y2="4"
              />
            </svg>
            <span>fato observado</span>
          </li>
          <li style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
            <svg aria-hidden="true" height="8" width="40">
              <line
                stroke="currentColor"
                strokeDasharray="6 4"
                strokeWidth="2"
                x1="0"
                x2="40"
                y1="4"
                y2="4"
              />
            </svg>
            <span>inferência</span>
          </li>
        </ul>
      </section>
    </aside>
  );
}
