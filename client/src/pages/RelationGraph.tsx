import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Loader2, Maximize, Tag, X, ZoomIn, ZoomOut } from 'lucide-react';
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
  getGraphProjectColor,
  withAlpha,
} from '@/lib/graph-colors.ts';
import { useTheme } from '@/providers/useTheme.ts';
import type {
  GraphLink,
  GraphNode,
  RelationGraphHandle,
} from '@/components/RelationGraphCanvas.tsx';

const GRAPH_TAG_PROJECTION_LIMIT = 120;
const TAG_EDGE_ALPHA_BASE = 0.065;
const TAG_EDGE_ALPHA_SCALE = 0.12;
const TAG_EDGE_SIZE_BASE = 0.36;
const TAG_EDGE_SIZE_SCALE = 1.65;

const GRAPH_STRENGTH_FILTERS = [
  { value: 'all', minScore: 0.12 },
  { value: 'strong', minScore: 0.55 },
  { value: 'medium', minScore: 0.32 },
  { value: 'weak', minScore: 0.12 },
] as const;

type GraphStrengthFilter = (typeof GRAPH_STRENGTH_FILTERS)[number]['value'];

const RelationGraphCanvas = lazy(() =>
  import('@/components/RelationGraphCanvas.tsx').then((module) => ({
    default: module.RelationGraphCanvas,
  })),
);

function getNoteText(note: Record<string, unknown>, key: string) {
  const value = note[key];
  return typeof value === 'string' ? value : '';
}

export function RelationGraph() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { themeName } = useTheme();
  const graphRef = useRef<RelationGraphHandle>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedTag, setSelectedTag] = useState<GraphNode | null>(null);
  const [selectedStrength, setSelectedStrength] = useState<GraphStrengthFilter>('all');

  const selectedStrengthConfig = useMemo(
    () => GRAPH_STRENGTH_FILTERS.find((item) => item.value === selectedStrength) ?? GRAPH_STRENGTH_FILTERS[0],
    [selectedStrength],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['relation-graph', 'tag', selectedStrengthConfig.minScore],
    queryFn: () =>
      api.getGraphProjection({
        level: 'tag',
        limit: GRAPH_TAG_PROJECTION_LIMIT,
        minScore: selectedStrengthConfig.minScore,
      }),
    placeholderData: (previousData) => previousData,
  });

  const selectedTagNotesQuery = useQuery({
    queryKey: ['graph-tag-notes', selectedTag?.name],
    queryFn: () => {
      if (!selectedTag) {
        return Promise.resolve({ items: [], total: 0, offset: 0, limit: 20 });
      }
      return api.getNotes({
        tag: selectedTag.name,
        limit: 20,
      });
    },
    enabled: Boolean(selectedTag),
  });

  const canvasColors = useMemo(() => {
    void themeName;
    return getGraphCanvasColors();
  }, [themeName]);

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    void themeName;

    const nodes: GraphNode[] = data.nodes.map((node, index) => {
      const noteCount = Math.max(0, node.note_count ?? 0);
      const degree = Math.max(0, node.degree);
      const sizeBase = node.kind === 'tag' ? noteCount : degree;

      return {
        id: node.id,
        kind: node.kind,
        title: node.title,
        name: node.name ?? node.title,
        note_count: noteCount,
        project_count: node.project_count ?? 0,
        project_name: node.project_name,
        tags: node.tags ?? [],
        degree,
        source_type: node.source_type ?? null,
        outcome_type: node.outcome_type ?? null,
        task_kind: node.task_kind ?? null,
        color: getGraphProjectColor(index),
        size: 5.5 + Math.sqrt(Math.max(1, sizeBase)) * 2.6,
      };
    });

    const links: GraphLink[] = data.edges.map((edge) => {
      const score = Math.max(0.05, Math.min(1, edge.score ?? edge.confidence ?? 0.2));
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        score,
        confidence: edge.confidence,
        cooccurrence_count: edge.cooccurrence_count,
        description: edge.description,
        created_by: edge.created_by,
        color: withAlpha(canvasColors.edge, TAG_EDGE_ALPHA_BASE + score * TAG_EDGE_ALPHA_SCALE),
        size: TAG_EDGE_SIZE_BASE + score * TAG_EDGE_SIZE_SCALE,
      };
    });

    return { nodes, links };
  }, [canvasColors.edge, data, themeName]);

  const hoveredRelatedTags = useMemo(() => {
    if (!hoveredNode) return [];
    const nodeById = new Map(graphData.nodes.map((node) => [node.id, node]));

    return graphData.links
      .filter((link) => link.source === hoveredNode.id || link.target === hoveredNode.id)
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .map((link) => nodeById.get(link.source === hoveredNode.id ? link.target : link.source))
      .filter((node): node is GraphNode => Boolean(node))
      .slice(0, 4);
  }, [graphData.links, graphData.nodes, hoveredNode]);

  useEffect(() => {
    if (graphData.nodes.length === 0) return;

    const timer = window.setTimeout(() => {
      graphRef.current?.fit();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [graphData.nodes.length]);

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode((current) => {
      if (current?.id === node?.id && current?.kind === node?.kind) return current;
      return node;
    });
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    if (node.kind === 'tag') {
      setSelectedTag(node);
      return;
    }
    navigate(`/notes/${node.id}`);
  }, [navigate]);

  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;
  const totalNodeCount = data?.stats.totalNodes ?? nodeCount;
  const isTruncated = Boolean(data?.truncated);
  const selectedTagNotes = selectedTagNotesQuery.data;
  const focusedGraphNode = hoveredNode ?? selectedTag;

  if (isLoading) {
    return (
      <div className="relative h-full overflow-hidden app-content-surface">
        <div className="flex h-full items-center justify-center text-muted">
          <Loader2 className="mr-2 animate-spin" />
          {t('status.loading')}
        </div>
      </div>
    );
  }

  if (nodeCount === 0) {
    return (
      <div className="relative h-full overflow-hidden app-content-surface">
        <div className="flex h-full items-center justify-center text-sm text-muted">
          {t('graph.empty')}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden app-content-surface">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-muted">
            <Loader2 className="mr-2 animate-spin" />
            {t('graph.loading_graph')}
          </div>
        }
      >
        <RelationGraphCanvas
          ref={graphRef}
          graphData={graphData}
          colors={canvasColors}
          focusedNodeKey={focusedGraphNode ? `${focusedGraphNode.kind}:${focusedGraphNode.id}` : null}
          onNodeHover={handleNodeHover}
          onNodeClick={handleNodeClick}
        />
      </Suspense>

      {hoveredNode && (
        <div
          data-graph-hover-card
          className="pointer-events-none absolute top-4 left-4 max-w-[280px] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200 motion-safe:ease-out motion-reduce:animate-none"
        >
          <div className="flex items-start gap-2">
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: withAlpha(hoveredNode.color, 0.9) }}
            />
            <div className="min-w-0">
              <div className="font-semibold text-foreground">{hoveredNode.name ?? hoveredNode.title}</div>
              <div className="mt-0.5 text-muted-foreground">
                {t('graph.tag_notes', { count: hoveredNode.note_count ?? 0 })}
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge variant="secondary" className="h-auto border border-border bg-tertiary px-1.5 py-0 text-[10px] text-foreground">
              {t('graph.degree', { count: hoveredNode.degree })}
            </Badge>
            <Badge variant="outline" className="h-auto border border-border bg-primary px-1.5 py-0 text-[10px] text-foreground">
              {t('graph.tag_projects', { count: hoveredNode.project_count ?? 0 })}
            </Badge>
          </div>
          {hoveredRelatedTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {hoveredRelatedTags.map((tag) => (
                <span
                  key={tag.id}
                  data-graph-hover-tag-pill
                  className="inline-flex max-w-full items-center rounded border border-border bg-tertiary px-1.5 py-0 text-[10px] leading-4 text-foreground"
                >
                  {tag.name ?? tag.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedTag && (
        <aside
          data-graph-detail-panel
          className="absolute top-3 right-3 flex max-h-[calc(100%-1.5rem)] w-[360px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-md border border-border bg-popover/95 text-popover-foreground shadow-xl backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-3 motion-safe:duration-200 motion-safe:ease-out motion-reduce:animate-none"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Tag className="h-3.5 w-3.5" />
                {t('graph.tag_detail')}
              </div>
              <h2 className="mt-1 truncate text-sm font-semibold text-foreground">
                {selectedTag.name ?? selectedTag.title}
              </h2>
              <div
                data-graph-detail-metrics
                className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground"
              >
                <span className="inline-flex items-center gap-1 rounded border border-border bg-secondary/50 px-1.5 py-0.5">
                  {t('graph.tag_detail_notes')}
                  <span className="font-semibold text-foreground">
                    {selectedTagNotes?.total ?? selectedTag.note_count ?? 0}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 rounded border border-border bg-secondary/50 px-1.5 py-0.5">
                  {t('graph.connections')}
                  <span className="font-semibold text-foreground">{selectedTag.degree}</span>
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelectedTag(null)}
              aria-label={t('common.close', { defaultValue: 'Close' })}
            >
              <X data-icon="inline-start" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {selectedTagNotesQuery.isLoading ? (
              <div className="flex items-center justify-center px-4 py-8 text-xs text-muted">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('status.loading')}
              </div>
            ) : selectedTagNotes?.items.length ? (
              <div className="divide-y divide-border">
                {selectedTagNotes.items.map((note) => {
                  const title = getNoteText(note, 'title') || t('notes.untitled', { defaultValue: '未命名笔记' });
                  const projectName = getNoteText(note, 'project_name');
                  const summary = getNoteText(note, 'summary') || getNoteText(note, 'key_conclusions');

                  return (
                    <button
                      key={String(note.id)}
                      type="button"
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-secondary/70"
                      onClick={() => navigate(`/notes/${note.id}`)}
                    >
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-xs font-medium text-foreground">{title}</div>
                          {projectName && (
                            <div className="mt-1 truncate text-[10px] text-muted-foreground">{projectName}</div>
                          )}
                          {summary && (
                            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                              {summary}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-xs text-muted">
                {t('graph.tag_detail_empty')}
              </div>
            )}
          </div>
        </aside>
      )}

      <div
        data-graph-control-panel
        className="pointer-events-none absolute bottom-3 left-3 flex w-fit max-w-[calc(100%-1.5rem)] flex-col gap-2"
      >
        <div
          data-graph-stats-panel
          className="pointer-events-auto flex w-full min-w-0 flex-col gap-0.5 rounded-md border border-border bg-popover/95 px-3 py-2 text-[10px] text-popover-foreground shadow-lg backdrop-blur-sm"
        >
          <span className="whitespace-nowrap text-muted-foreground">
            {nodeCount} {t('graph.knowledge_points')} · {edgeCount} {t('graph.connections')}
          </span>
          {isTruncated && (
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">
              {t('graph.truncated_tags', { visible: nodeCount, total: totalNodeCount })}
            </span>
          )}
        </div>

        <div
          data-graph-action-row
          className="flex w-fit max-w-full items-center gap-2"
        >
          <div
            data-graph-view-controls
            className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-md border border-border bg-popover/95 p-1.5 text-popover-foreground shadow-lg backdrop-blur-sm"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => graphRef.current?.fit()}
              title={t('graph.fit_to_view')}
              aria-label={t('graph.fit_to_view')}
            >
              <Maximize data-icon="inline-start" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => graphRef.current?.zoomIn()}
              aria-label={t('graph.zoom_in')}
            >
              <ZoomIn data-icon="inline-start" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => graphRef.current?.zoomOut()}
              aria-label={t('graph.zoom_out')}
            >
              <ZoomOut data-icon="inline-start" />
            </Button>
          </div>

          <div
            data-graph-strength-filters
            className="pointer-events-auto min-w-0 w-fit rounded-md border border-border bg-popover/95 px-2.5 py-2 text-[10px] text-popover-foreground shadow-lg backdrop-blur-sm"
          >
            <ToggleGroup
              type="single"
              value={selectedStrength}
              onValueChange={(value) => {
                setSelectedStrength((value || 'all') as GraphStrengthFilter);
              }}
              variant="outline"
              size="sm"
              className="flex-nowrap justify-start gap-1"
            >
              {GRAPH_STRENGTH_FILTERS.map((filter) => (
                <ToggleGroupItem
                  key={filter.value}
                  value={filter.value}
                  className="h-6 rounded-md px-2 text-[10px] data-[state=on]:border-[var(--accent)] data-[state=on]:text-accent"
                >
                  {t(`graph.strength.${filter.value}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </div>
    </div>
  );
}
