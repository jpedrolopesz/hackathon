import type { GraphViewNode } from '@/application/read-models/graph-view-contract';
import { LEARNING_STATE_PRESENTATION } from '@/web/graph/graph-legend';

export interface GraphNodePanelProps {
  readonly node: GraphViewNode;
  readonly onClose: () => void;
}

function NodeDetails({ node }: { readonly node: GraphViewNode }) {
  switch (node.type) {
    case 'CONCEPT':
      return (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>{node.title}</h2>
          <p>{node.description}</p>
          <dl style={{ display: 'grid', gap: 12 }}>
            <div>
              <dt style={{ fontWeight: 600 }}>Estado do conceito</dt>
              <dd>
                {LEARNING_STATE_PRESENTATION[node.learningState].label}
              </dd>
            </div>
            <div>
              <dt style={{ fontWeight: 600 }}>Justificativa da regra</dt>
              <dd>{node.explanation}</dd>
            </div>
          </dl>
        </>
      );
    case 'MODULE':
      return (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>{node.title}</h2>
          <p>{node.description}</p>
        </>
      );
    case 'MATERIAL':
      return (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>{node.title}</h2>
          <dl style={{ display: 'grid', gap: 12 }}>
            <div>
              <dt style={{ fontWeight: 600 }}>Tipo de material</dt>
              <dd>{node.materialType}</dd>
            </div>
            <div>
              <dt style={{ fontWeight: 600 }}>Referência de origem</dt>
              <dd style={{ overflowWrap: 'anywhere' }}>{node.sourceRef}</dd>
            </div>
          </dl>
        </>
      );
    case 'DOUBT':
      return (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>
            Registro do que foi perguntado
          </h2>
          <p>{node.summary}</p>
          <dl>
            <div>
              <dt style={{ fontWeight: 600 }}>Data</dt>
              <dd>
                <time dateTime={node.createdAt}>
                  {new Intl.DateTimeFormat('pt-BR', {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  }).format(new Date(node.createdAt))}
                </time>
              </dd>
            </div>
          </dl>
        </>
      );
  }
}

export function GraphNodePanel({ node, onClose }: GraphNodePanelProps) {
  return (
    <aside
      aria-label="Detalhes do nó selecionado"
      style={{
        border: '1px solid currentColor',
        borderRadius: 8,
        display: 'grid',
        gap: 16,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          aria-label="Fechar detalhes do nó"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: '1px solid currentColor',
            borderRadius: 6,
            cursor: 'pointer',
            padding: '6px 10px',
          }}
          type="button"
        >
          Fechar
        </button>
      </div>
      <div style={{ display: 'grid', gap: 16 }}>
        <NodeDetails node={node} />
      </div>
    </aside>
  );
}
