/**
 * TopologyDiffTab — "Changes" tab for the topology page.
 * Shows structural changes between two topology snapshots over time.
 *
 * Integration: Add as a tab in TopologyPage.tsx:
 *   <Tab value="changes" label="Changes"><TopologyDiffTab clusterId={clusterId} /></Tab>
 */
import { useState, useMemo, useCallback } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { format, subDays } from "date-fns";
import {
  CalendarIcon,
  Camera,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Plus,
  Minus,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  GitCompareArrows,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { useTopologyDiff, useCreateSnapshot } from "@/hooks/useTopologyDiff";
import { DiffNode } from "./DiffNodes/DiffNode";
import { DiffEdge } from "./DiffEdges/DiffEdge";
import { K8sIcon } from "./icons/K8sIcon";
import type {
  TopologyDiff,
  SnapshotNode,
  SnapshotEdge,
  EdgeChange,
} from "@/services/api/topologyDiff";

// ─── Constants ──────────────────────────────────────────────────────────────

const NODE_TYPES = { diff: DiffNode } as const;
const EDGE_TYPES = { diff: DiffEdge } as const;

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function formatDisplayDate(date: Date): string {
  return format(date, "MMM d, yyyy");
}

// ─── Date Picker ────────────────────────────────────────────────────────────

function DatePicker({
  value,
  onChange,
  label,
}: {
  value: Date;
  onChange: (d: Date) => void;
  label: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "justify-start text-left font-normal gap-2 min-w-[150px]",
            "text-gray-700 dark:text-gray-300",
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 text-gray-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">{label}:</span>
          <span className="text-xs font-medium">{formatDisplayDate(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && onChange(d)}
          disabled={(d) => d > new Date()}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Quick Presets ──────────────────────────────────────────────────────────

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

// ─── Graph Builder ──────────────────────────────────────────────────────────

interface DiffGraph {
  nodes: Node[];
  edges: Edge[];
}

function buildDiffGraph(diff: TopologyDiff): DiffGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeIdSet = new Set<string>();

  // Collect all node IDs from edges to determine unchanged nodes
  const allNodeIdsFromEdges = new Set<string>();
  for (const e of diff.added_edges) {
    allNodeIdsFromEdges.add(e.source);
    allNodeIdsFromEdges.add(e.target);
  }
  for (const e of diff.removed_edges) {
    allNodeIdsFromEdges.add(e.source);
    allNodeIdsFromEdges.add(e.target);
  }
  for (const e of diff.changed_edges) {
    allNodeIdsFromEdges.add(e.source);
    allNodeIdsFromEdges.add(e.target);
  }

  // Added nodes
  for (const n of diff.added_nodes) {
    nodeIdSet.add(n.id);
    nodes.push({
      id: n.id,
      type: "diff",
      position: { x: 0, y: 0 },
      data: {
        label: n.name,
        kind: n.kind,
        namespace: n.namespace,
        health: n.health,
        diffStatus: "added",
      },
    });
  }

  // Removed nodes
  for (const n of diff.removed_nodes) {
    nodeIdSet.add(n.id);
    nodes.push({
      id: n.id,
      type: "diff",
      position: { x: 0, y: 0 },
      data: {
        label: n.name,
        kind: n.kind,
        namespace: n.namespace,
        health: n.health,
        diffStatus: "removed",
      },
    });
  }

  // Create unchanged placeholder nodes for edge endpoints not in added/removed
  for (const nodeId of allNodeIdsFromEdges) {
    if (!nodeIdSet.has(nodeId)) {
      nodeIdSet.add(nodeId);
      nodes.push({
        id: nodeId,
        type: "diff",
        position: { x: 0, y: 0 },
        data: {
          label: nodeId.split('/').pop() ?? nodeId,
          kind: "Unknown",
          namespace: "",
          diffStatus: "unchanged",
        },
      });
    }
  }

  // Added edges
  for (const e of diff.added_edges) {
    edges.push({
      id: `added-${e.source}-${e.target}-${e.type}`,
      source: e.source,
      target: e.target,
      type: "diff",
      data: {
        diffStatus: "added",
        label: e.type,
      },
    });
  }

  // Removed edges
  for (const e of diff.removed_edges) {
    edges.push({
      id: `removed-${e.source}-${e.target}-${e.type}`,
      source: e.source,
      target: e.target,
      type: "diff",
      data: {
        diffStatus: "removed",
        label: e.type,
      },
    });
  }

  // Changed edges
  for (const e of diff.changed_edges) {
    edges.push({
      id: `changed-${e.source}-${e.target}-${e.type}`,
      source: e.source,
      target: e.target,
      type: "diff",
      data: {
        diffStatus: "changed",
        label: `${e.old_weight.toFixed(2)} \u2192 ${e.new_weight.toFixed(2)}`,
      },
    });
  }

  // Simple grid layout for nodes
  const COLS = Math.max(3, Math.ceil(Math.sqrt(nodes.length)));
  const GAP_X = 320;
  const GAP_Y = 180;
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].position = {
      x: (i % COLS) * GAP_X,
      y: Math.floor(i / COLS) * GAP_Y,
    };
  }

  return { nodes, edges };
}

// ─── Summary Banner ─────────────────────────────────────────────────────────

function DiffSummaryBanner({ diff }: { diff: TopologyDiff }) {
  const { summary } = diff;

  return (
    <div className="space-y-2">
      {/* Natural language summary */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
        <GitCompareArrows className="h-5 w-5 text-blue-500 shrink-0" />
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
          {summary.natural_language}
        </p>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-2">
        {summary.nodes_added > 0 && (
          <Badge className="bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 gap-1">
            <Plus className="h-3 w-3" />
            {summary.nodes_added} resource{summary.nodes_added !== 1 ? 's' : ''}
          </Badge>
        )}
        {summary.nodes_removed > 0 && (
          <Badge className="bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800 gap-1">
            <Minus className="h-3 w-3" />
            {summary.nodes_removed} resource{summary.nodes_removed !== 1 ? 's' : ''}
          </Badge>
        )}
        {summary.edges_added > 0 && (
          <Badge className="bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 gap-1">
            <Plus className="h-3 w-3" />
            {summary.edges_added} dep{summary.edges_added !== 1 ? 's' : ''}
          </Badge>
        )}
        {summary.edges_removed > 0 && (
          <Badge className="bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800 gap-1">
            <Minus className="h-3 w-3" />
            {summary.edges_removed} dep{summary.edges_removed !== 1 ? 's' : ''}
          </Badge>
        )}
        {summary.edges_changed > 0 && (
          <Badge className="bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 gap-1">
            ~{summary.edges_changed} changed
          </Badge>
        )}
      </div>

      {/* SPOF warning */}
      {summary.new_spofs > 0 && (
        <div className={cn(
          "flex items-center gap-2 rounded-lg px-4 py-2 text-sm",
          "bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700",
          "text-amber-800 dark:text-amber-200",
        )}>
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="font-medium">
            {summary.new_spofs} new single point{summary.new_spofs !== 1 ? 's' : ''} of failure introduced
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Changes Side Panel ─────────────────────────────────────────────────────

function NodeListItem({ node, variant }: { node: SnapshotNode; variant: 'added' | 'removed' }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-1">
      <K8sIcon kind={node.kind} size={16} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
          {node.name}
        </div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400">
          {node.kind} {node.namespace ? `\u00b7 ${node.namespace}` : ''}
        </div>
      </div>
      <span className={cn(
        "shrink-0 h-1.5 w-1.5 rounded-full",
        variant === 'added' ? "bg-green-500" : "bg-red-500",
      )} />
    </div>
  );
}

function EdgeListItem({ edge, variant }: {
  edge: SnapshotEdge;
  variant: 'added' | 'removed';
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-1">
      <ChevronRight className={cn(
        "h-3 w-3 shrink-0",
        variant === 'added' ? "text-green-500" : "text-red-500",
      )} />
      <div className="min-w-0 flex-1 text-xs text-gray-700 dark:text-gray-300 truncate">
        <span className="font-medium">{edge.source.split('/').pop()}</span>
        <span className="text-gray-400 mx-1">{"\u2192"}</span>
        <span className="font-medium">{edge.target.split('/').pop()}</span>
      </div>
      <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
        {edge.type}
      </span>
    </div>
  );
}

function ChangedEdgeListItem({ edge }: { edge: EdgeChange }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-1">
      <ChevronRight className="h-3 w-3 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1 text-xs text-gray-700 dark:text-gray-300 truncate">
        <span className="font-medium">{edge.source.split('/').pop()}</span>
        <span className="text-gray-400 mx-1">{"\u2192"}</span>
        <span className="font-medium">{edge.target.split('/').pop()}</span>
      </div>
      <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 shrink-0">
        {edge.old_weight.toFixed(2)} {"\u2192"} {edge.new_weight.toFixed(2)}
      </span>
    </div>
  );
}

function ChangesSidePanel({
  diff,
  open,
  onToggle,
}: {
  diff: TopologyDiff;
  open: boolean;
  onToggle: () => void;
}) {
  const hasAddedNodes = diff.added_nodes.length > 0;
  const hasRemovedNodes = diff.removed_nodes.length > 0;
  const hasAddedEdges = diff.added_edges.length > 0;
  const hasRemovedEdges = diff.removed_edges.length > 0;
  const hasChangedEdges = diff.changed_edges.length > 0;

  return (
    <div className={cn(
      "border-l border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 transition-all duration-200 overflow-hidden shrink-0",
      open ? "w-80" : "w-0",
    )}>
      {open && (
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-slate-700">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Changes
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>

          {/* Accordion list */}
          <div className="flex-1 overflow-y-auto">
            <Accordion type="multiple" defaultValue={["added-resources", "removed-resources"]}>
              {hasAddedNodes && (
                <AccordionItem value="added-resources">
                  <AccordionTrigger className="px-3 py-2.5 text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Added Resources ({diff.added_nodes.length})
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-2">
                    {diff.added_nodes.map((n) => (
                      <NodeListItem key={n.id} node={n} variant="added" />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )}

              {hasRemovedNodes && (
                <AccordionItem value="removed-resources">
                  <AccordionTrigger className="px-3 py-2.5 text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Removed Resources ({diff.removed_nodes.length})
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-2">
                    {diff.removed_nodes.map((n) => (
                      <NodeListItem key={n.id} node={n} variant="removed" />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )}

              {hasAddedEdges && (
                <AccordionItem value="added-deps">
                  <AccordionTrigger className="px-3 py-2.5 text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      New Dependencies ({diff.added_edges.length})
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-2">
                    {diff.added_edges.map((e) => (
                      <EdgeListItem
                        key={`${e.source}-${e.target}-${e.type}`}
                        edge={e}
                        variant="added"
                      />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )}

              {hasRemovedEdges && (
                <AccordionItem value="removed-deps">
                  <AccordionTrigger className="px-3 py-2.5 text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Removed Dependencies ({diff.removed_edges.length})
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-2">
                    {diff.removed_edges.map((e) => (
                      <EdgeListItem
                        key={`${e.source}-${e.target}-${e.type}`}
                        edge={e}
                        variant="removed"
                      />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )}

              {hasChangedEdges && (
                <AccordionItem value="changed-deps">
                  <AccordionTrigger className="px-3 py-2.5 text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      Changed Dependencies ({diff.changed_edges.length})
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-2">
                    {diff.changed_edges.map((e) => (
                      <ChangedEdgeListItem
                        key={`${e.source}-${e.target}-${e.type}`}
                        edge={e}
                      />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>

            {!hasAddedNodes && !hasRemovedNodes && !hasAddedEdges && !hasRemovedEdges && !hasChangedEdges && (
              <div className="px-4 py-8 text-center text-xs text-gray-500 dark:text-gray-400">
                No structural changes detected.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Diff Canvas ────────────────────────────────────────────────────────────

function DiffCanvasInner({ diff }: { diff: TopologyDiff }) {
  const { nodes, edges } = useMemo(() => buildDiffGraph(diff), [diff]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.05}
      maxZoom={2}
      panOnScroll
      panOnScrollSpeed={1.5}
      zoomOnScroll={false}
      zoomOnPinch
      proOptions={{ hideAttribution: true }}
      className="!bg-slate-50 dark:!bg-slate-950"
      nodesDraggable
      nodesConnectable={false}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        className="!text-gray-300 dark:!text-slate-800"
      />
      <MiniMap
        nodeStrokeWidth={0}
        maskColor="rgba(0, 0, 0, 0.06)"
        className="!bg-white dark:!bg-slate-900 !border !border-gray-200 dark:!border-slate-700 !rounded-lg !shadow-md"
        style={{ width: 150, height: 100 }}
        pannable
        zoomable
      />
      <Controls
        showZoom
        showFitView
        showInteractive={false}
        className="!bg-white dark:!bg-slate-800 !border !border-gray-200 dark:!border-slate-700 !rounded-lg !shadow-md [&>button]:dark:!bg-slate-800 [&>button]:dark:!border-slate-700 [&>button]:dark:!fill-gray-300 [&>button:hover]:dark:!bg-slate-700"
      />
    </ReactFlow>
  );
}

function DiffCanvas({ diff }: { diff: TopologyDiff }) {
  return (
    <ReactFlowProvider>
      <DiffCanvasInner diff={diff} />
    </ReactFlowProvider>
  );
}

// ─── Skeleton Loading ───────────────────────────────────────────────────────

function DiffLoadingSkeleton() {
  return (
    <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <div className="space-y-2 text-center">
          <div className="h-3 w-48 rounded bg-gray-200 dark:bg-slate-700 animate-pulse" />
          <div className="h-3 w-32 rounded bg-gray-200 dark:bg-slate-700 animate-pulse mx-auto" />
        </div>
      </div>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────────────

function DiffEmptyState({ type }: { type: 'no-snapshots' | 'no-changes' | 'error' | 'select' }) {
  const content: Record<string, { icon: React.ReactNode; title: string; detail: string }> = {
    'no-snapshots': {
      icon: <Camera className="h-10 w-10 text-gray-400 dark:text-gray-500" />,
      title: "No topology snapshots found",
      detail: "Take a snapshot to start tracking structural changes.",
    },
    'no-changes': {
      icon: <GitCompareArrows className="h-10 w-10 text-gray-400 dark:text-gray-500" />,
      title: "No structural changes detected",
      detail: "No changes between the selected dates.",
    },
    'select': {
      icon: <GitCompareArrows className="h-10 w-10 text-gray-400 dark:text-gray-500" />,
      title: "Compare topology snapshots",
      detail: "Select a date range and click Compare to see structural changes over time.",
    },
    'error': {
      icon: <AlertTriangle className="h-10 w-10 text-red-400" />,
      title: "Failed to load diff",
      detail: "Could not retrieve the topology diff. Try again.",
    },
  };

  const c = content[type];

  return (
    <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs">
        {c.icon}
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{c.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{c.detail}</p>
      </div>
    </div>
  );
}

// ─── Diff Legend ─────────────────────────────────────────────────────────────

function DiffLegend() {
  return (
    <div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-3 py-2 shadow-sm backdrop-blur-sm text-[10px]">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded border-2 border-green-500 bg-green-50 dark:bg-green-950" />
        <span className="text-gray-600 dark:text-gray-400">Added</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded border-2 border-dashed border-red-500 bg-red-50 dark:bg-red-950" />
        <span className="text-gray-600 dark:text-gray-400">Removed</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded border-2 border-amber-500 bg-amber-50 dark:bg-amber-950" />
        <span className="text-gray-600 dark:text-gray-400">Changed</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded border border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-800 opacity-50" />
        <span className="text-gray-600 dark:text-gray-400">Unchanged</span>
      </span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export interface TopologyDiffTabProps {
  clusterId: string | null;
}

export function TopologyDiffTab({ clusterId }: TopologyDiffTabProps) {
  const today = useMemo(() => new Date(), []);
  const [fromDate, setFromDate] = useState<Date>(() => subDays(today, 7));
  const [toDate, setToDate] = useState<Date>(today);
  const [hasFetched, setHasFetched] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);

  // Only fetch when user explicitly clicks Compare
  const [fetchEnabled, setFetchEnabled] = useState(false);

  const { data: diff, loading, error, refetch } = useTopologyDiff({
    clusterId,
    fromDate: formatDate(fromDate),
    toDate: formatDate(toDate),
    enabled: fetchEnabled,
  });

  const { createSnapshot, loading: snapshotLoading } = useCreateSnapshot({ clusterId });

  const handleCompare = useCallback(() => {
    setFetchEnabled(true);
    setHasFetched(true);
    // If already enabled, refetch with current params
    refetch();
  }, [refetch]);

  const handlePreset = useCallback((days: number) => {
    const now = new Date();
    setFromDate(subDays(now, days));
    setToDate(now);
    setFetchEnabled(false);
    setHasFetched(false);
  }, []);

  const handleSnapshot = useCallback(() => {
    createSnapshot();
  }, [createSnapshot]);

  const toggleSidePanel = useCallback(() => {
    setSidePanelOpen((v) => !v);
  }, []);

  // Determine whether diff has any actual changes
  const hasChanges = diff && (
    diff.added_nodes.length > 0 ||
    diff.removed_nodes.length > 0 ||
    diff.added_edges.length > 0 ||
    diff.removed_edges.length > 0 ||
    diff.changed_edges.length > 0
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-950">
      {/* Top bar: date range selector + actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-slate-700 px-4 py-2.5 bg-white dark:bg-slate-900">
        <DatePicker value={fromDate} onChange={(d) => { setFromDate(d); setFetchEnabled(false); }} label="From" />
        <DatePicker value={toDate} onChange={(d) => { setToDate(d); setFetchEnabled(false); }} label="To" />

        <Button
          size="sm"
          onClick={handleCompare}
          disabled={loading || !clusterId}
          className="gap-1.5"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Compare
        </Button>

        {/* Quick presets */}
        <div className="hidden sm:flex items-center gap-1 ml-1 border-l border-gray-200 dark:border-slate-700 pl-2">
          {PRESETS.map((p) => (
            <Button
              key={p.days}
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => handlePreset(p.days)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {/* Toggle side panel */}
          {diff && hasChanges && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidePanel} title="Toggle changes panel">
              {sidePanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleSnapshot}
            disabled={snapshotLoading || !clusterId}
            className="gap-1.5"
          >
            {snapshotLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Take Snapshot
          </Button>
        </div>
      </div>

      {/* Summary banner (when diff data available) */}
      {diff && (
        <div className="px-4 py-2 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
          <DiffSummaryBanner diff={diff} />
        </div>
      )}

      {/* Main area: canvas + side panel */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas or empty/loading state */}
        {loading ? (
          <DiffLoadingSkeleton />
        ) : error ? (
          <DiffEmptyState type="error" />
        ) : !hasFetched ? (
          <DiffEmptyState type="select" />
        ) : diff && hasChanges ? (
          <div className="relative flex-1">
            <DiffCanvas diff={diff} />
            <DiffLegend />
          </div>
        ) : diff && !hasChanges ? (
          <DiffEmptyState type="no-changes" />
        ) : (
          <DiffEmptyState type="no-snapshots" />
        )}

        {/* Side panel */}
        {diff && hasChanges && (
          <ChangesSidePanel
            diff={diff}
            open={sidePanelOpen}
            onToggle={toggleSidePanel}
          />
        )}
      </div>
    </div>
  );
}
