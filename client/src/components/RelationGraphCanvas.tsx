import { forwardRef, memo, useEffect, useImperativeHandle, useMemo } from 'react';
import {
  SigmaContainer,
  useCamera,
  useLoadGraph,
  useRegisterEvents,
  useSigma,
} from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import { MultiDirectedGraph } from 'graphology';
import circular from 'graphology-layout/circular';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { SigmaOptions } from 'sigma/types';
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

type SigmaGraphAttributes = Record<string, never>;

type CustomNodeState = {
  isFocused: boolean;
  isRelated: boolean;
};

type CustomEdgeState = {
  isFocused: boolean;
};

type CustomGraphState = {
  hasFocus: boolean;
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
  const graph = new MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes, SigmaGraphAttributes>();
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

function resolveBodyFont() {
  if (typeof document === 'undefined') return 'system-ui, sans-serif';
  const fontBody = getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim();
  return fontBody || 'system-ui, sans-serif';
}

function SigmaGraphStateSync({
  graph,
  focusedNodeKey,
}: {
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes, SigmaGraphAttributes>;
  focusedNodeKey: string | null;
}) {
  const sigma = useSigma<
    SigmaNodeAttributes,
    SigmaEdgeAttributes,
    SigmaGraphAttributes,
    CustomNodeState,
    CustomEdgeState,
    CustomGraphState
  >();

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
    const sigmaGraph = sigma.getGraph();
    const hasFocus = Boolean(focusedNodeKey && sigmaGraph.hasNode(focusedNodeKey));

    sigma.setGraphState({ hasFocus });

    for (const node of sigmaGraph.nodes()) {
      sigma.setNodeState(node, {
        isFocused: hasFocus && node === focusedNodeKey,
        isRelated: hasFocus && focusedNeighborKeys.has(node),
      });
    }

    for (const edge of sigmaGraph.edges()) {
      sigma.setEdgeState(edge, {
        isFocused: hasFocus && focusedEdgeKeys.has(edge),
      });
    }
  }, [focusedEdgeKeys, focusedNeighborKeys, focusedNodeKey, graph, sigma]);

  return null;
}

function SigmaGraphEvents({
  graph,
  onNodeHover,
  onNodeClick,
}: {
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes, SigmaGraphAttributes>;
  onNodeHover: (node: GraphNode | null) => void;
  onNodeClick: (node: GraphNode) => void;
}) {
  const loadGraph = useLoadGraph<SigmaNodeAttributes, SigmaEdgeAttributes, SigmaGraphAttributes>();
  const registerEvents = useRegisterEvents<
    SigmaNodeAttributes,
    SigmaEdgeAttributes,
    SigmaGraphAttributes,
    CustomNodeState,
    CustomEdgeState,
    CustomGraphState
  >();

  useEffect(() => {
    loadGraph(graph);
  }, [graph, loadGraph]);

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
    const sigmaOptions = useMemo<
      Partial<
        SigmaOptions<
          SigmaNodeAttributes,
          SigmaEdgeAttributes,
          SigmaGraphAttributes,
          CustomNodeState,
          CustomEdgeState,
          CustomGraphState
        >
      >
    >(() => {
      const labelFont = resolveBodyFont();

      return {
        customNodeState: { isFocused: false, isRelated: false },
        customEdgeState: { isFocused: false },
        customGraphState: { hasFocus: false },
        settings: {
          allowInvalidContainer: true,
          autoRescale: true,
          enableEdgeEvents: false,
          hideEdgesOnMove: false,
          hideLabelsOnMove: true,
          itemSizesReference: 'screen',
          labelRenderedSizeThreshold: 9,
          minEdgeThickness: 0.8,
          renderEdgeLabels: false,
          renderLabels: true,
          stagePadding: 48,
        },
        styles: {
          nodes: {
            x: { attribute: 'x' },
            y: { attribute: 'y' },
            depth: (_attrs, state, graphState) => (graphState.hasFocus && state.isFocused ? 'topNodes' : 'nodes'),
            zIndex: (attrs, state, graphState) => (graphState.hasFocus && state.isFocused ? attrs.zIndex + 1000 : attrs.zIndex),
            color: (attrs, state, graphState) =>
              graphState.hasFocus && !state.isRelated
                ? withAlpha(colors.dimmedNode, 0.28)
                : attrs.color || colors.muted,
            size: (attrs, state, graphState) => {
              if (graphState.hasFocus && state.isFocused) return attrs.size * 1.18;
              if (graphState.hasFocus && state.isRelated) return attrs.size * 1.06;
              return attrs.size;
            },
            label: { attribute: 'label' },
            labelColor: colors.hoverForeground,
            labelFont,
            labelSize: 11,
            labelBackgroundColor: (_attrs, state, graphState) =>
              withAlpha(colors.hoverBackground, graphState.hasFocus && state.isFocused ? 0.92 : 0.78),
            labelBackgroundPadding: 3,
            labelVisibility: (attrs, state, graphState) => {
              if (graphState.hasFocus && !state.isRelated) return 'hidden';
              if ((graphState.hasFocus && state.isFocused) || shouldForceNodeLabel(attrs)) return 'visible';
              return 'auto';
            },
            backdropVisibility: (_attrs, state, graphState) =>
              graphState.hasFocus && state.isFocused ? 'visible' : 'hidden',
            backdropArea: 'node',
            backdropColor: colors.hoverBackground,
            backdropBorderColor: colors.hoverBorder,
            backdropBorderWidth: 1,
            backdropShadowColor: colors.hoverShadow,
            backdropShadowBlur: 10,
            backdropPadding: 3,
          },
          edges: {
            depth: (_attrs, state, graphState) => (graphState.hasFocus && state.isFocused ? 'topEdges' : 'edges'),
            zIndex: (_attrs, state, graphState) => (graphState.hasFocus && state.isFocused ? 1000 : 0),
            color: (attrs, state, graphState) => {
              if (graphState.hasFocus && state.isFocused) return withAlpha(colors.activeEdge, 0.86);
              if (graphState.hasFocus) return withAlpha(colors.dimmedEdge, 0.14);
              return attrs.color || colors.dimmedEdge;
            },
            size: (attrs, state, graphState) => {
              if (graphState.hasFocus && state.isFocused) return attrs.size + 1.1;
              if (graphState.hasFocus) return Math.max(0.35, attrs.size * 0.5);
              return attrs.size;
            },
            label: { attribute: 'label' },
            labelColor: { attribute: 'color' },
          },
        },
      };
    }, [colors]);

    return (
      <SigmaContainer<
        SigmaNodeAttributes,
        SigmaEdgeAttributes,
        SigmaGraphAttributes,
        CustomNodeState,
        CustomEdgeState,
        CustomGraphState
      >
        className="h-full w-full"
        options={sigmaOptions}
        style={{ height: '100%', width: '100%', background: 'transparent' }}
      >
        <SigmaGraphEvents graph={graph} onNodeHover={onNodeHover} onNodeClick={onNodeClick} />
        <SigmaGraphStateSync graph={graph} focusedNodeKey={focusedNodeKey} />
        <SigmaCameraBridge ref={ref} />
      </SigmaContainer>
    );
  },
);

RelationGraphCanvasComponent.displayName = 'RelationGraphCanvas';

export const RelationGraphCanvas = memo(RelationGraphCanvasComponent);
