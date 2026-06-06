import { forwardRef, memo, useEffect, useImperativeHandle, useMemo } from 'react';
import {
  SigmaContainer,
  useCamera,
  useLoadGraph,
  useRegisterEvents,
  useSetSettings,
  useSigma,
} from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import { MultiDirectedGraph } from 'graphology';
import circular from 'graphology-layout/circular';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { Settings } from 'sigma/settings';
import type { NodeHoverDrawingFunction, NodeLabelDrawingFunction } from 'sigma/rendering';
import { withAlpha } from '@/lib/graph-colors.ts';

export interface GraphNode {
  id: number;
  kind: 'tag' | 'note';
  title: string;
  name?: string;
  note_count?: number;
  project_count?: number;
  project_name?: string;
  tags?: string[];
  degree: number;
  source_type?: string | null;
  outcome_type?: string | null;
  task_kind?: string | null;
  color: string;
  size: number;
}

export interface GraphLink {
  id: number | string;
  source: number;
  target: number;
  type: string;
  confidence?: number;
  score?: number;
  cooccurrence_count?: number;
  description?: string | null;
  created_by?: string;
  color: string;
  size: number;
}

export interface RelationGraphHandle {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

type SigmaNodeAttributes = GraphNode & {
  label: string;
  labelRank: number;
  x: number;
  y: number;
  zIndex: number;
};

type SigmaEdgeAttributes = GraphLink & {
  label: string;
  weight: number;
};

type GraphCanvasColors = {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  activeEdge: string;
  edge: string;
  dimmedNode: string;
  dimmedEdge: string;
  hoverBackground: string;
  hoverForeground: string;
  hoverBorder: string;
  hoverShadow: string;
};

interface RelationGraphCanvasProps {
  graphData: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
  colors: GraphCanvasColors;
  focusedNodeKey: string | null;
  onNodeHover: (node: GraphNode | null) => void;
  onNodeClick: (node: GraphNode) => void;
}

function nodeKey(node: Pick<GraphNode, 'id' | 'kind'>) {
  return `${node.kind}:${node.id}`;
}

function edgeKey(id: number | string) {
  return `relation:${id}`;
}

function buildGraph(graphData: RelationGraphCanvasProps['graphData']) {
  const graph = new MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const nodeKeyById = new Map<number, string>();

  graphData.nodes.forEach((node, index) => {
    const key = nodeKey(node);
    nodeKeyById.set(node.id, key);
    graph.addNode(key, {
      ...node,
      label: node.title,
      labelRank: index,
      x: 0,
      y: 0,
      zIndex: node.degree,
    });
  });

  circular.assign(graph, { scale: Math.max(60, graph.order * 4) });

  if (graph.order > 1) {
    forceAtlas2.assign(graph, {
      iterations: Math.min(140, Math.max(40, graph.order)),
      settings: {
        ...forceAtlas2.inferSettings(graph),
        gravity: 0.08,
        scalingRatio: 16,
        slowDown: 4,
      },
      getEdgeWeight: 'weight',
    });
  }

  for (const link of graphData.links) {
    const source = nodeKeyById.get(link.source);
    const target = nodeKeyById.get(link.target);
    if (!source || !target) continue;
    if (!graph.hasNode(source) || !graph.hasNode(target)) continue;

    graph.addDirectedEdgeWithKey(edgeKey(link.id), source, target, {
      ...link,
      label: link.type,
      weight: Math.max(0.2, link.score ?? link.confidence ?? 0.2),
    });
  }

  return graph;
}

function shouldForceNodeLabel(data: SigmaNodeAttributes) {
  return data.kind === 'tag'
    ? data.degree > 0 || data.labelRank < 24
    : data.degree > 0 || data.degree >= 3;
}

function drawLabelBackground(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawThemeNodeLabel(colors: GraphCanvasColors): NodeLabelDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes> {
  return (context, data, settings) => {
    const label = typeof data.label === 'string' ? data.label : '';
    if (!label) return;

    const labelSize = settings.labelSize;
    const x = data.x + data.size + 6;
    const y = data.y;
    const paddingX = data.highlighted ? 7 : 5;
    const paddingY = data.highlighted ? 3 : 2;
    const boxHeight = labelSize + paddingY * 2;

    context.save();
    context.font = `${settings.labelWeight} ${labelSize}px ${settings.labelFont}`;
    context.textAlign = 'left';
    context.textBaseline = 'middle';

    const boxWidth = context.measureText(label).width + paddingX * 2;
    drawLabelBackground(context, x - paddingX, y - boxHeight / 2, boxWidth, boxHeight, 4);
    context.fillStyle = withAlpha(colors.hoverBackground, data.highlighted ? 0.92 : 0.78);
    context.fill();
    context.strokeStyle = withAlpha(colors.hoverBorder, data.highlighted ? 0.92 : 0.62);
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = colors.hoverForeground;
    context.fillText(label, x, y);
    context.restore();
  };
}

function drawThemeNodeHover(colors: GraphCanvasColors): NodeHoverDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes> {
  return (context, data) => {
    const nodeRadius = data.size + 3;

    context.save();
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 2;
    context.shadowBlur = 10;
    context.shadowColor = colors.hoverShadow;

    context.fillStyle = colors.hoverBackground;
    context.strokeStyle = colors.hoverBorder;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(data.x, data.y, nodeRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = data.color;
    context.beginPath();
    context.arc(data.x, data.y, data.size + 1, 0, Math.PI * 2);
    context.fill();

    context.restore();
  };
}

function SigmaGraphReducers({
  graph,
  colors,
  focusedNodeKey,
}: {
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  colors: GraphCanvasColors;
  focusedNodeKey: string | null;
}) {
  const setSettings = useSetSettings<SigmaNodeAttributes, SigmaEdgeAttributes>();

  const { focusedNeighborKeys, focusedEdgeKeys } = useMemo(() => {
    const focusedNeighborKeys = new Set<string>();
    const focusedEdgeKeys = new Set<string>();

    if (focusedNodeKey && graph.hasNode(focusedNodeKey)) {
      focusedNeighborKeys.add(focusedNodeKey);
      for (const edge of graph.edges(focusedNodeKey)) {
        focusedEdgeKeys.add(edge);
        const [source, target] = graph.extremities(edge);
        focusedNeighborKeys.add(source);
        focusedNeighborKeys.add(target);
      }
    }

    return { focusedNeighborKeys, focusedEdgeKeys };
  }, [focusedNodeKey, graph]);

  useEffect(() => {
    setSettings({
      nodeReducer: (node: string, data: SigmaNodeAttributes) => {
        const hasFocus = Boolean(focusedNodeKey);
        const isFocused = hasFocus && node === focusedNodeKey;
        const isRelated = hasFocus && focusedNeighborKeys.has(node);
        const isDimmed = hasFocus && !isRelated;
        const shouldShowLabel = shouldForceNodeLabel(data);

        return {
          color: isDimmed ? withAlpha(colors.dimmedNode, 0.28) : data.color,
          forceLabel: !isDimmed && (isFocused || shouldShowLabel),
          highlighted: isFocused,
          label: isDimmed ? null : data.title,
          size: isFocused ? data.size * 1.18 : isRelated ? data.size * 1.06 : data.size,
          x: data.x,
          y: data.y,
          zIndex: isFocused ? data.zIndex + 1000 : data.zIndex,
        };
      },
      edgeReducer: (edge: string, data: SigmaEdgeAttributes) => {
        const hasFocus = Boolean(focusedNodeKey);
        const isFocused = hasFocus && focusedEdgeKeys.has(edge);
        const isDimmed = hasFocus && !isFocused;

        return {
          color: isFocused
            ? withAlpha(colors.activeEdge, 0.86)
            : isDimmed
              ? withAlpha(colors.dimmedEdge, 0.14)
              : data.color,
          label: data.type,
          size: isFocused ? data.size + 1.1 : isDimmed ? Math.max(0.35, data.size * 0.5) : data.size,
          zIndex: isFocused ? 1000 : 0,
        };
      },
    });
  }, [
    colors.activeEdge,
    colors.dimmedEdge,
    colors.dimmedNode,
    focusedEdgeKeys,
    focusedNeighborKeys,
    focusedNodeKey,
    setSettings,
  ]);

  return null;
}

function SigmaGraphEvents({
  graph,
  onNodeHover,
  onNodeClick,
}: {
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  onNodeHover: (node: GraphNode | null) => void;
  onNodeClick: (node: GraphNode) => void;
}) {
  const loadGraph = useLoadGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const registerEvents = useRegisterEvents<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const sigma = useSigma<SigmaNodeAttributes, SigmaEdgeAttributes>();

  useEffect(() => {
    loadGraph(graph);
    sigma.refresh();
  }, [graph, loadGraph, sigma]);

  useEffect(() => {
    registerEvents({
      enterNode: ({ node }) => {
        onNodeHover(graph.getNodeAttributes(node));
      },
      leaveNode: () => {
        onNodeHover(null);
      },
      clickNode: ({ node }) => {
        onNodeClick(graph.getNodeAttributes(node));
      },
    });
  }, [graph, onNodeClick, onNodeHover, registerEvents]);

  return null;
}

const SigmaCameraBridge = forwardRef<RelationGraphHandle>(function SigmaCameraBridge(_, ref) {
  const { reset, zoomIn, zoomOut } = useCamera({ duration: 300, factor: 1.35 });

  useImperativeHandle(ref, () => ({
    fit: () => reset({ duration: 400 }),
    zoomIn: () => zoomIn({ duration: 260, factor: 1.3 }),
    zoomOut: () => zoomOut({ duration: 260, factor: 1.3 }),
  }), [reset, zoomIn, zoomOut]);

  return null;
});

const RelationGraphCanvasComponent = forwardRef<RelationGraphHandle, RelationGraphCanvasProps>(
  function RelationGraphCanvas({
    graphData,
    colors,
    focusedNodeKey,
    onNodeHover,
    onNodeClick,
  }, ref) {
    const graph = useMemo(() => buildGraph(graphData), [graphData]);
    const sigmaSettings = useMemo(() => ({
      allowInvalidContainer: true,
      autoCenter: true,
      autoRescale: true,
      defaultNodeColor: colors.muted,
      defaultEdgeColor: colors.dimmedEdge,
      defaultEdgeType: 'line',
      defaultDrawNodeLabel: drawThemeNodeLabel(colors),
      defaultDrawNodeHover: drawThemeNodeHover(colors),
      edgeLabelColor: { attribute: 'color' },
      enableEdgeEvents: false,
      hideEdgesOnMove: false,
      hideLabelsOnMove: true,
      itemSizesReference: 'screen',
      labelColor: { color: colors.foreground },
      labelFont: 'var(--font-body), system-ui, sans-serif',
      labelRenderedSizeThreshold: 9,
      labelSize: 11,
      minEdgeThickness: 0.8,
      renderEdgeLabels: false,
      renderLabels: true,
      stagePadding: 48,
      zIndex: true,
    } satisfies Partial<Settings<SigmaNodeAttributes, SigmaEdgeAttributes>>), [colors]);

    return (
      <SigmaContainer<SigmaNodeAttributes, SigmaEdgeAttributes>
        className="h-full w-full"
        settings={sigmaSettings}
        style={{ height: '100%', width: '100%', background: 'transparent' }}
      >
        <SigmaGraphReducers graph={graph} colors={colors} focusedNodeKey={focusedNodeKey} />
        <SigmaGraphEvents graph={graph} onNodeHover={onNodeHover} onNodeClick={onNodeClick} />
        <SigmaCameraBridge ref={ref} />
      </SigmaContainer>
    );
  },
);

RelationGraphCanvasComponent.displayName = 'RelationGraphCanvas';

export const RelationGraphCanvas = memo(RelationGraphCanvasComponent);
