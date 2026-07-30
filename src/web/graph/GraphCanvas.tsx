'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ForceGraphProps,
  LinkObject,
  NodeObject,
} from 'react-force-graph-2d';
import type { ComponentType } from 'react';

import type {
  GraphViewEdge,
  GraphViewEnvelope,
  GraphViewNode,
} from '@/web/graph/graph-view-contract';
import {
  GraphLegend,
  LEARNING_STATE_PRESENTATION,
  STATELESS_NODE_COLORS,
} from '@/web/graph/graph-legend';

type GraphForceProps = ForceGraphProps<GraphViewNode, GraphViewEdge>;

const ForceGraph2D = dynamic<GraphForceProps>(
  () =>
    import('react-force-graph-2d').then(
      (module) => module.default as ComponentType<GraphForceProps>,
    ),
  { ssr: false },
);

export interface GraphCanvasProps {
  readonly graph: GraphViewEnvelope;
}

interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

function getNodeLabel(node: GraphViewNode): string {
  if (node.type === 'CONCEPT') {
    return `${node.title} — ${LEARNING_STATE_PRESENTATION[node.learningState].label}`;
  }

  return node.type === 'DOUBT' ? node.summary : node.title;
}

function getNodeColor(node: GraphViewNode): string {
  return node.type === 'CONCEPT'
    ? LEARNING_STATE_PRESENTATION[node.learningState].color
    : STATELESS_NODE_COLORS[node.type];
}

export function GraphCanvas({ graph }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const updateSize = () => {
      const { width, height } = container.getBoundingClientRect();
      setCanvasSize({ width, height });
    };
    const resizeObserver = new ResizeObserver(updateSize);

    updateSize();
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  const graphData = useMemo(
    () => ({
      nodes: graph.data.nodes.map((node) => ({ ...node })),
      links: graph.data.edges.map((edge) => ({ ...edge })),
    }),
    [graph],
  );

  const drawNodeLabel = (
    node: NodeObject<GraphViewNode>,
    context: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    if (node.x === undefined || node.y === undefined) {
      return;
    }

    const label = getNodeLabel(node);
    const fontSize = 12 / globalScale;
    const padding = 2 / globalScale;

    context.font = `${fontSize}px sans-serif`;
    const textWidth = context.measureText(label).width;
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.fillRect(
      node.x - textWidth / 2 - padding,
      node.y + 7 / globalScale,
      textWidth + padding * 2,
      fontSize + padding * 2,
    );
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = '#111827';
    context.fillText(label, node.x, node.y + 9 / globalScale);
  };

  const getLinkLineDash = (
    link: LinkObject<GraphViewNode, GraphViewEdge>,
  ): number[] | null => (link.style === 'DASHED' ? [6, 4] : null);

  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        width: '100%',
      }}
    >
      <GraphLegend />
      <div
        ref={containerRef}
        style={{
          height: 'min(70vh, 720px)',
          minHeight: 384,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {canvasSize.width > 0 && canvasSize.height > 0 ? (
          <ForceGraph2D
            graphData={graphData}
            height={canvasSize.height}
            linkLineDash={getLinkLineDash}
            linkSource="source"
            linkTarget="target"
            nodeCanvasObject={drawNodeLabel}
            nodeCanvasObjectMode={() => 'after'}
            nodeColor={(node) => getNodeColor(node)}
            nodeId="id"
            nodeLabel={(node) => getNodeLabel(node)}
            nodeVal={(node) => (node.type === 'DOUBT' ? 10 : 5)}
            width={canvasSize.width}
          />
        ) : null}
      </div>
    </div>
  );
}
