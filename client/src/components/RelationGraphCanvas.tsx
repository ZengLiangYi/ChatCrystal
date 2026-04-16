import type { MutableRefObject } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';

export interface GraphNode {
  id: number;
  title: string;
  project_name: string;
  tags: string[];
  color: string;
  val: number;
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: number;
  target: number;
  type: string;
  confidence: number;
  color: string;
}

interface RelationGraphCanvasProps {
  graphRef: MutableRefObject<ForceGraphMethods<any, any> | undefined>;
  graphData: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
  paintNode: (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => void;
  paintLink: (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => void;
  onNodeHover: (node: GraphNode | null) => void;
  onNodeClick: (node: GraphNode) => void;
}

export function RelationGraphCanvas({
  graphRef,
  graphData,
  paintNode,
  paintLink,
  onNodeHover,
  onNodeClick,
}: RelationGraphCanvasProps) {
  return (
    <ForceGraph2D
      ref={graphRef}
      graphData={graphData}
      nodeCanvasObject={paintNode}
      linkCanvasObject={paintLink}
      nodePointerAreaPaint={(node, color, ctx) => {
        const radius = Math.sqrt(node.val) * 3 + 3;
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }}
      onNodeHover={(node) => onNodeHover(node as GraphNode | null)}
      onNodeClick={(node) => onNodeClick(node as GraphNode)}
      nodeLabel={() => ''}
      cooldownTicks={100}
      warmupTicks={50}
      d3AlphaDecay={0.02}
      d3VelocityDecay={0.3}
      backgroundColor="transparent"
    />
  );
}
