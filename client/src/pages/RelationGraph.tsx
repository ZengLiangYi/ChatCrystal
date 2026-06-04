import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group.tsx';
import { api } from '@/lib/api.ts';
import {
  getGraphCanvasColors,
  getGraphEdgeColor,
  getGraphProjectColor,
  GRAPH_RELATION_TYPES,
  withAlpha,
} from '@/lib/graph-colors.ts';
import { useTheme } from '@/providers/useTheme.ts';
import type { GraphLink, GraphNode } from '@/components/RelationGraphCanvas.tsx';
import type { ForceGraphMethods } from 'react-force-graph-2d';

const RelationGraphCanvas = lazy(() =>
  import('@/components/RelationGraphCanvas.tsx').then((module) => ({
    default: module.RelationGraphCanvas,
  })),
);

export function RelationGraph() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { themeName } = useTheme();
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>(undefined);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['relation-graph'],
    queryFn: () => api.getRelationGraph(),
  });

  const canvasColors = useMemo(() => {
    void themeName;
    return getGraphCanvasColors();
  }, [themeName]);
  const relationLegendColors = useMemo(
    () => {
      void themeName;
      return Object.fromEntries(
        GRAPH_RELATION_TYPES.map((type) => [type, getGraphEdgeColor(type)]),
      );
    },
    [themeName],
  );

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    void themeName;

    const projects = [...new Set(data.nodes.map((node) => node.project_name))];
    const projectColorMap = new Map(
      projects.map((projectName, index) => [
        projectName,
        getGraphProjectColor(index),
      ]),
    );

    const connectionCount = new Map<number, number>();
    for (const edge of data.edges) {
      connectionCount.set(edge.source, (connectionCount.get(edge.source) || 0) + 1);
      connectionCount.set(edge.target, (connectionCount.get(edge.target) || 0) + 1);
    }

    const nodes: GraphNode[] = data.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      project_name: node.project_name,
      tags: node.tags,
      color: projectColorMap.get(node.project_name) ?? getGraphProjectColor(0),
      val: 2 + (connectionCount.get(node.id) || 0),
    }));

    const links: GraphLink[] = data.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      confidence: edge.confidence,
      color: getGraphEdgeColor(edge.type),
    }));

    return { nodes, links };
  }, [data, themeName]);

  useEffect(() => {
    if (graphData.nodes.length === 0) return;

    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(550, 72);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [graphData.nodes.length]);

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isHovered = hoveredNode?.id === node.id;
      const radius = Math.sqrt(node.val) * 3;
      const x = node.x!;
      const y = node.y!;

      ctx.save();

      if (isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 10 / globalScale, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(node.color, 0.22);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(node.color, isHovered ? 0.96 : 0.78);
      ctx.fill();
      ctx.strokeStyle = isHovered
        ? withAlpha(canvasColors.foreground, 0.94)
        : withAlpha(node.color, 0.82);
      ctx.lineWidth = (isHovered ? 1.6 : 0.8) / globalScale;
      ctx.stroke();

      if (globalScale > 0.65 || isHovered) {
        const fontSize = (isHovered ? 13 : 10.5) / globalScale;
        const label = node.title.length > 14 ? `${node.title.slice(0, 13)}…` : node.title;
        ctx.font = `${isHovered ? '600 ' : ''}${fontSize}px var(--font-body), system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3 / globalScale;
        ctx.strokeStyle = withAlpha(canvasColors.background, 0.88);
        ctx.fillStyle = isHovered
          ? canvasColors.foreground
          : withAlpha(canvasColors.foreground, 0.78);
        ctx.strokeText(label, x, y + radius + 3 / globalScale);
        ctx.fillText(label, x, y + radius + 3 / globalScale);
      }

      ctx.restore();
    },
    [canvasColors, hoveredNode],
  );

  const paintLink = useCallback(
    (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const source = link.source as unknown as GraphNode;
      const target = link.target as unknown as GraphNode;
      if (
        typeof source.x !== 'number' ||
        typeof source.y !== 'number' ||
        typeof target.x !== 'number' ||
        typeof target.y !== 'number'
      ) {
        return;
      }

      const isActive = !selectedType || link.type === selectedType;
      const confidence = Math.max(0.15, Math.min(1, link.confidence));
      const strokeAlpha = isActive ? 0.5 + confidence * 0.28 : 0.07;
      const arrowAlpha = isActive ? 0.78 + confidence * 0.18 : 0.12;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      if (isActive) {
        ctx.strokeStyle = withAlpha(link.color, 0.16);
        ctx.lineWidth = 4.5 / globalScale;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
      }
      ctx.strokeStyle = withAlpha(link.color, strokeAlpha);
      ctx.lineWidth = (isActive ? 1.05 + confidence * 1.65 : 0.35) / globalScale;
      ctx.stroke();

      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      const arrowLen = (isActive ? 5.5 : 4) / globalScale;

      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - arrowLen * Math.cos(angle - 0.5), my - arrowLen * Math.sin(angle - 0.5));
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - arrowLen * Math.cos(angle + 0.5), my - arrowLen * Math.sin(angle + 0.5));
      ctx.strokeStyle = withAlpha(link.color, arrowAlpha);
      ctx.lineWidth = (isActive ? 1.35 : 0.65) / globalScale;
      ctx.stroke();
      ctx.restore();
    },
    [selectedType],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 className="mr-2 animate-spin" />
        {t('status.loading')}
      </div>
    );
  }

  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;

  if (nodeCount === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center border-b border-theme bg-secondary px-4 py-3">
          <h2 className="text-sm font-bold">{t('graph.title')}</h2>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          {t('graph.empty')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-theme bg-secondary px-4 py-3">
        <h2 className="text-sm font-bold">{t('graph.title')}</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {nodeCount} {t('graph.nodes')} · {edgeCount} {t('graph.edges')}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => graphRef.current?.zoomToFit(400, 60)}
              title={t('graph.fit_to_view')}
              aria-label={t('graph.fit_to_view')}
            >
              <Maximize data-icon="inline-start" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                const currentZoom = graphRef.current?.zoom();
                if (currentZoom) graphRef.current?.zoom(currentZoom * 1.3, 300);
              }}
              aria-label={t('graph.zoom_in')}
            >
              <ZoomIn data-icon="inline-start" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                const currentZoom = graphRef.current?.zoom();
                if (currentZoom) graphRef.current?.zoom(currentZoom * 0.7, 300);
              }}
              aria-label={t('graph.zoom_out')}
            >
              <ZoomOut data-icon="inline-start" />
            </Button>
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden app-content-surface">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-muted">
              <Loader2 className="mr-2 animate-spin" />
              {t('graph.loading_graph')}
            </div>
          }
        >
          <RelationGraphCanvas
            graphRef={graphRef as never}
            graphData={graphData}
            paintNode={paintNode}
            paintLink={paintLink}
            onNodeHover={setHoveredNode}
            onNodeClick={(node) => navigate(`/notes/${node.id}`)}
          />
        </Suspense>

        {hoveredNode && (
          <div className="pointer-events-none absolute top-4 right-4 max-w-[260px] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
            <div className="font-semibold text-foreground">{hoveredNode.title}</div>
            <div className="mt-0.5 text-muted-foreground">{hoveredNode.project_name}</div>
            {hoveredNode.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {hoveredNode.tags.slice(0, 5).map((tag) => (
                  <Badge key={tag} variant="secondary" className="h-auto px-1.5 py-0 text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-popover/95 px-2.5 py-2 text-[10px] text-popover-foreground shadow-lg backdrop-blur-sm">
          <ToggleGroup
            type="single"
            value={selectedType ?? 'all'}
            onValueChange={(value) => {
              setSelectedType(value && value !== 'all' ? value : null);
            }}
            variant="outline"
            size="sm"
            className="flex-wrap justify-start gap-1"
          >
            <ToggleGroupItem
              value="all"
              className="h-6 rounded-md px-2 text-[10px] data-[state=on]:border-[var(--accent)] data-[state=on]:text-accent"
            >
              {t('filter.all')}
            </ToggleGroupItem>
            {GRAPH_RELATION_TYPES.map((type) => (
              <ToggleGroupItem
                key={type}
                value={type}
                className="h-6 rounded-md px-2 text-[10px] data-[state=on]:border-[var(--accent)] data-[state=on]:text-accent"
              >
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ background: relationLegendColors[type] }}
                />
                {t(`relation.short.${type}`, { defaultValue: type })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
    </div>
  );
}
