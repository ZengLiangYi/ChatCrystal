import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { api } from '@/lib/api.ts';

// =============================================
// Constants
// =============================================

const EDGE_COLORS: Record<string, string> = {
  CAUSED_BY:   '#ef4444',
  LEADS_TO:    '#f97316',
  RESOLVED_BY: '#22c55e',
  SIMILAR_TO:  '#3b82f6',
  CONTRADICTS: '#eab308',
  DEPENDS_ON:  '#a855f7',
  EXTENDS:     '#06b6d4',
  REFERENCES:  '#6b7280',
};

const RELATION_LABELS: Record<string, { zh: string; en: string }> = {
  CAUSED_BY:   { zh: '因果', en: 'Caused' },
  LEADS_TO:    { zh: '导致', en: 'Leads' },
  RESOLVED_BY: { zh: '解决', en: 'Resolved' },
  SIMILAR_TO:  { zh: '相似', en: 'Similar' },
  CONTRADICTS: { zh: '矛盾', en: 'Contra' },
  DEPENDS_ON:  { zh: '依赖', en: 'Depends' },
  EXTENDS:     { zh: '扩展', en: 'Extends' },
  REFERENCES:  { zh: '引用', en: 'Refs' },
};

const PROJECT_COLORS = [
  '#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444',
  '#06b6d4', '#eab308', '#ec4899', '#14b8a6', '#8b5cf6',
];

// =============================================
// Types for ForceGraph
// =============================================

interface GraphNode {
  id: number;
  title: string;
  project_name: string;
  tags: string[];
  color: string;
  val: number;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: number;
  target: number;
  type: string;
  confidence: number;
  color: string;
}

// =============================================
// Component
// =============================================

export function RelationGraph() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const navigate = useNavigate();
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>(undefined);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['relation-graph'],
    queryFn: () => api.getRelationGraph(),
  });

  // Build graph data
  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };

    // Assign colors by project
    const projects = [...new Set(data.nodes.map((n) => n.project_name))];
    const projectColorMap = new Map(projects.map((p, i) => [p, PROJECT_COLORS[i % PROJECT_COLORS.length]]));

    // Count connections per node for sizing
    const connectionCount = new Map<number, number>();
    for (const e of data.edges) {
      connectionCount.set(e.source, (connectionCount.get(e.source) || 0) + 1);
      connectionCount.set(e.target, (connectionCount.get(e.target) || 0) + 1);
    }

    const nodes: GraphNode[] = data.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      project_name: n.project_name,
      tags: n.tags,
      color: projectColorMap.get(n.project_name) || '#6b7280',
      val: 2 + (connectionCount.get(n.id) || 0), // More connections = bigger node
    }));

    const links: GraphLink[] = data.edges
      .filter((e) => !selectedType || e.type === selectedType)
      .map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type,
        confidence: e.confidence,
        color: (EDGE_COLORS[e.type] || '#6b7280') + '80',
      }));

    return { nodes, links };
  }, [data, selectedType]);

  // Custom node rendering
  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isHovered = hoveredNode?.id === node.id;
      const radius = Math.sqrt(node.val) * 3;
      const x = node.x!;
      const y = node.y!;

      // Glow for hovered
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = node.color + '30';
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      if (isHovered) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Label (only show when zoomed in enough or hovered)
      if (globalScale > 0.6 || isHovered) {
        const fontSize = isHovered ? 14 / globalScale : 11 / globalScale;
        const label = node.title.length > 12 ? node.title.slice(0, 11) + '…' : node.title;
        ctx.font = `${isHovered ? 'bold ' : ''}${fontSize}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isHovered ? '#ffffff' : '#ffffffcc';
        ctx.fillText(label, x, y + radius + 2 / globalScale);
      }
    },
    [hoveredNode],
  );

  // Custom link rendering with arrows
  const paintLink = useCallback(
    (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const source = link.source as unknown as GraphNode;
      const target = link.target as unknown as GraphNode;
      if (!source.x || !target.x) return;

      ctx.beginPath();
      ctx.moveTo(source.x!, source.y!);
      ctx.lineTo(target.x!, target.y!);
      ctx.strokeStyle = link.color;
      ctx.lineWidth = (0.5 + link.confidence) / globalScale;
      ctx.stroke();

      // Arrow at midpoint
      const mx = (source.x! + target.x!) / 2;
      const my = (source.y! + target.y!) / 2;
      const angle = Math.atan2(target.y! - source.y!, target.x! - source.x!);
      const arrowLen = 5 / globalScale;

      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - arrowLen * Math.cos(angle - 0.5), my - arrowLen * Math.sin(angle - 0.5));
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - arrowLen * Math.cos(angle + 0.5), my - arrowLen * Math.sin(angle + 0.5));
      ctx.strokeStyle = link.color.replace(/80$/, 'cc');
      ctx.lineWidth = 1.5 / globalScale;
      ctx.stroke();
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted">
        <Loader2 size={20} className="animate-spin mr-2" />
        {isZh ? '加载中...' : 'Loading...'}
      </div>
    );
  }

  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;

  if (nodeCount === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-4 py-3 border-b border-theme bg-secondary shrink-0">
          <h2 className="text-sm font-bold">{isZh ? '知识图谱' : 'Knowledge Graph'}</h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          {isZh ? '暂无数据，请先生成笔记并发现关联' : 'No data. Generate notes and discover relations first.'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-theme bg-secondary shrink-0">
        <h2 className="text-sm font-bold">
          {isZh ? '知识图谱' : 'Knowledge Graph'}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {nodeCount} {isZh ? '节点' : 'nodes'} · {edgeCount} {isZh ? '关系' : 'edges'}
          </span>
          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => graphRef.current?.zoomToFit(400, 60)}
              className="p-1 text-muted hover:text-accent transition-colors"
              title={isZh ? '适应画面' : 'Fit to view'}
            >
              <Maximize size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                const cur = graphRef.current?.zoom();
                if (cur) graphRef.current?.zoom(cur * 1.3, 300);
              }}
              className="p-1 text-muted hover:text-accent transition-colors"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                const cur = graphRef.current?.zoom();
                if (cur) graphRef.current?.zoom(cur * 0.7, 300);
              }}
              className="p-1 text-muted hover:text-accent transition-colors"
            >
              <ZoomOut size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Graph */}
      <div className="flex-1 relative overflow-hidden">
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
          onNodeHover={(node) => setHoveredNode(node as GraphNode | null)}
          onNodeClick={(node) => navigate(`/notes/${node.id}`)}
          nodeLabel={() => ''} // We handle labels in paintNode
          cooldownTicks={100}
          warmupTicks={50}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          backgroundColor="transparent"
        />

        {/* Tooltip */}
        {hoveredNode && (
          <div
            className="absolute top-4 right-4 px-3 py-2 bg-primary border border-theme text-xs pointer-events-none max-w-[220px]"
            style={{ borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
          >
            <div className="font-bold text-primary">{hoveredNode.title}</div>
            <div className="text-muted mt-0.5">{hoveredNode.project_name}</div>
            {hoveredNode.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {hoveredNode.tags.slice(0, 5).map((tag) => (
                  <span key={tag} className="px-1 py-0.5 text-[10px] bg-tertiary text-muted border border-theme" style={{ borderRadius: '3px' }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Legend: relation type filter */}
        <div
          className="absolute bottom-3 left-3 px-3 py-2 bg-primary/90 border border-theme text-[10px] backdrop-blur-sm"
          style={{ borderRadius: '6px' }}
        >
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => setSelectedType(null)}
              className={`flex items-center gap-1 px-1 py-0.5 transition-colors ${!selectedType ? 'text-accent' : 'text-muted hover:text-primary'}`}
              style={{ borderRadius: '3px' }}
            >
              {isZh ? '全部' : 'All'}
            </button>
            {Object.entries(EDGE_COLORS).map(([type, color]) => (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedType(selectedType === type ? null : type)}
                className={`flex items-center gap-1 px-1 py-0.5 transition-colors ${selectedType === type ? 'text-accent' : 'text-muted hover:text-primary'}`}
                style={{ borderRadius: '3px' }}
              >
                <span className="inline-block w-2.5 h-0.5" style={{ background: color }} />
                {RELATION_LABELS[type] ? (isZh ? RELATION_LABELS[type].zh : RELATION_LABELS[type].en) : type}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
