import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PodStatusDistribution } from '@/features/dashboard/components/PodStatusDistribution';
import { ClusterEfficiencyCard } from '@/components/dashboard/ClusterEfficiencyCard';
import {
  ListPagination,
  PAGE_SIZE_OPTIONS,
  ColumnVisibilityDropdown,
  TableColumnHeaderWithFilterAndSort,
  TableFilterCell,
  TableFilterProvider,
} from '@/components/list';
import {
  Activity,
  AlertTriangle,
  Search,
  RefreshCcw,
  Zap,
  Box,
  Layers,
  Container,
  Clock,
  ChevronRight,
  Loader2,
  AlertCircle,
  ChevronDown,
  Filter,
  PanelRightClose,
  PanelRightOpen,
  Info,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useWorkloadsOverview } from '@/hooks/useWorkloadsOverview';
import { useClusterStore } from '@/stores/clusterStore';
import { getDetailPath } from '@/utils/resourceKindMapper';
import { ConnectionRequiredBanner } from '@/components/layout/ConnectionRequiredBanner';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';

const KIND_ICONS: Record<string, typeof Container> = {
  Deployment: Container,
  StatefulSet: Layers,
  DaemonSet: Box,
  Job: Activity,
  CronJob: Clock,
};

const STATUS_COLORS: Record<string, string> = {
  Running: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Healthy: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Optimal: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Completed: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Scheduled: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  'Scaled to Zero': 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Failed: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
};

const PRESSURE_COLORS: Record<string, string> = {
  Low: 'text-emerald-500',
  Normal: 'text-emerald-500',
  Medium: 'text-amber-500',
  Elevated: 'text-amber-500',
  High: 'text-rose-500',
  Zero: 'text-muted-foreground',
  Idle: 'text-muted-foreground',
  Unknown: 'text-muted-foreground',
};

type WorkloadItem = {
  kind: string;
  name: string;
  namespace: string;
  status: string;
  ready: number;
  desired: number;
  pressure: string;
};

function getWorkloadKey(w: WorkloadItem): string {
  return `${w.kind}/${w.namespace}/${w.name}`;
}

const WORKLOADS_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'status', label: 'Status' },
  { id: 'replicas', label: 'Replicas' },
  { id: 'pressure', label: 'Pressure' },
];

export default function WorkloadsOverview() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const queryClient = useQueryClient();
  const { activeCluster } = useClusterStore();
  const { data, isLoading, isError, refetch } = useWorkloadsOverview();

  const handleSync = useCallback(() => {
    setIsSyncing(true);
    queryClient.invalidateQueries({ queryKey: ['k8s'] });
    queryClient.invalidateQueries({ queryKey: ['backend', 'resources'] });
    queryClient.invalidateQueries({ queryKey: ['backend', 'workloads'] });
    queryClient.invalidateQueries({ queryKey: ['backend', 'clusterOverview'] });
    refetch();
    setTimeout(() => setIsSyncing(false), 2500);
  }, [queryClient, refetch]);

  const workloads: WorkloadItem[] = data?.workloads ?? [];
  const itemsAfterSearch = useMemo(() => {
    if (!searchQuery.trim()) return workloads;
    const q = searchQuery.toLowerCase();
    return workloads.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.namespace.toLowerCase().includes(q) ||
        w.kind.toLowerCase().includes(q)
    );
  }, [workloads, searchQuery]);

  const workloadsTableConfig: ColumnConfig<WorkloadItem>[] = useMemo(() => [
    { columnId: 'kind', getValue: (w) => w.kind, sortable: true, filterable: true },
    { columnId: 'name', getValue: (w) => w.name, sortable: true, filterable: false },
    { columnId: 'namespace', getValue: (w) => w.namespace || 'default', sortable: true, filterable: true },
    { columnId: 'status', getValue: (w) => w.status, sortable: true, filterable: true },
    {
      columnId: 'replicas',
      getValue: (w) => (w.desired > 0 ? `${w.ready}/${w.desired}` : '—'),
      sortable: true,
      filterable: false,
      compare: (a, b) => {
        const ra = a.desired > 0 ? a.ready / a.desired : 0;
        const rb = b.desired > 0 ? b.ready / b.desired : 0;
        return ra - rb;
      },
    },
    {
      columnId: 'pressure',
      getValue: (w) => {
        const p = w.pressure;
        return p === 'Low' || p === 'Normal' ? 'Normal' : p === 'Medium' || p === 'Elevated' ? 'Elevated' : p === 'Zero' || p === 'Idle' ? 'Idle' : p;
      },
      sortable: true,
      filterable: true,
    },
  ], []);

  const {
    filteredAndSortedItems: filteredWorkloads,
    distinctValuesByColumn,
    valueCountsByColumn,
    columnFilters,
    setColumnFilter,
    sortKey,
    sortOrder,
    setSort,
    clearAllFilters,
    hasActiveFilters,
  } = useTableFiltersAndSort(itemsAfterSearch, {
    columns: workloadsTableConfig,
    defaultSortKey: 'kind',
    defaultSortOrder: 'asc',
  });

  const columnVisibility = useColumnVisibility({
    tableId: 'workloads-overview',
    columns: WORKLOADS_COLUMNS_FOR_VISIBILITY,
    alwaysVisible: ['kind', 'name'],
  });

  const totalFiltered = filteredWorkloads.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredWorkloads.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const toggleSelection = (w: WorkloadItem) => {
    const key = getWorkloadKey(w);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map(getWorkloadKey)));
  };

  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const pulse = data?.pulse;
  const alerts = data?.alerts;

  const pulseBreakdown = useMemo(() => {
    if (!pulse) return null;
    const byKind: Record<string, number> = {};
    for (const w of workloads) {
      byKind[w.kind] = (byKind[w.kind] ?? 0) + 1;
    }
    const workloadTotal = workloads.length;
    const podTotal = Math.max(0, pulse.total - workloadTotal);
    return {
      byKind: Object.entries(byKind)
        .sort(([, a], [, b]) => b - a)
        .map(([kind, count]) => ({ kind, count })),
      workloadTotal,
      podTotal,
      total: pulse.total,
    };
  }, [pulse, workloads]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <ConnectionRequiredBanner />

      {/* Header */}
      <SectionOverviewHeader
        title="Workloads Overview"
        description="AI-powered visibility across cluster resource performance and health"
        onSync={handleSync}
        isSyncing={isSyncing}
      />

      {/* Workload Health Pulse + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 overflow-hidden border-primary/10 bg-gradient-to-br from-background via-background to-primary/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Workload Health Pulse
            </CardTitle>
            {pulse && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-[10px] font-bold uppercase tracking-wider">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {pulse.optimal_percent >= 95 ? 'Optimal' : pulse.optimal_percent >= 80 ? 'Good' : pulse.optimal_percent >= 60 ? 'Fair' : 'At Risk'}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[200px] flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
              </div>
            ) : (isError || !activeCluster) && !data ? (
              <div className="h-[200px] flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <AlertCircle className="h-12 w-12" />
                <p className="text-sm">Connect a cluster to see workload health</p>
              </div>
            ) : pulse ? (
              <div className="h-[200px] w-full flex items-center justify-center relative">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
                  <Activity className="h-40 w-40 text-primary" />
                </div>
                <div className="text-center z-10 flex flex-col items-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-5xl font-black mb-2 flex flex-baseline gap-1.5 items-center cursor-help">
                        {pulse.total}
                        <span className="text-xl font-medium text-muted-foreground">Resources</span>
                        <Info className="h-5 w-5 text-muted-foreground/70" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs p-3">
                      <div className="space-y-2 text-left">
                        <p className="font-semibold text-foreground">Resource breakdown</p>
                        <p className="text-xs text-muted-foreground">
                          Total = workload controllers (Explorer table) + pods. Explorer lists only controllers.
                        </p>
                        {pulseBreakdown ? (
                          <div className="space-y-1 text-xs font-mono">
                            {pulseBreakdown.byKind.map(({ kind, count }) => (
                              <div key={kind} className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{kind}</span>
                                <span className="tabular-nums">{count}</span>
                              </div>
                            ))}
                            <div className="flex justify-between gap-4 pt-1 border-t border-border">
                              <span className="text-muted-foreground">Workload controllers</span>
                              <span className="tabular-nums font-medium">{pulseBreakdown.workloadTotal}</span>
                            </div>
                            {pulseBreakdown.podTotal > 0 && (
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Pods</span>
                                <span className="tabular-nums">{pulseBreakdown.podTotal}</span>
                              </div>
                            )}
                            <div className="flex justify-between gap-4 pt-1 border-t border-border font-medium">
                              <span>Total</span>
                              <span className="tabular-nums">{pulseBreakdown.total}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Total: {pulse.total}</p>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                  <div className="flex gap-6 mt-4">
                    <div className="text-center">
                      <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Healthy</div>
                      <div className="text-xl font-bold text-emerald-500">{pulse.healthy}</div>
                    </div>
                    <div className="w-px h-10 bg-border" />
                    <div className="text-center">
                      <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Warning</div>
                      <div className="text-xl font-bold text-amber-500">{pulse.warning}</div>
                    </div>
                    <div className="w-px h-10 bg-border" />
                    <div className="text-center">
                      <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Critical</div>
                      <div className="text-xl font-bold text-rose-500">{pulse.critical}</div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    {pulse.optimal_percent.toFixed(1)}% optimal
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                No data
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts / Insights */}
        <Card className="border-amber-500/20 bg-gradient-to-br from-background to-amber-500/5">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Alerts & Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : alerts && (alerts.warnings > 0 || alerts.critical > 0) ? (
              <>
                <div className="flex gap-3 text-sm">
                  {alerts.warnings > 0 && (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                      {alerts.warnings} Warning{alerts.warnings !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  {alerts.critical > 0 && (
                    <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-500/20">
                      {alerts.critical} Critical
                    </Badge>
                  )}
                </div>
                {alerts.top_3?.length > 0 && (
                  <div className="space-y-2">
                    {alerts.top_3.map((a, i) => (
                      <div
                        key={i}
                        className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs"
                      >
                        <p className="font-medium text-foreground">{a.reason}</p>
                        <p className="text-muted-foreground truncate">{a.resource}</p>
                        {a.namespace && (
                          <p className="text-muted-foreground text-[10px]">{a.namespace}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <Link to="/events" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  View all events
                  <ChevronRight className="w-3 h-3" />
                </Link>
              </>
            ) : (
              <div className="py-6 text-center">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs font-medium">
                  No active alerts
                </div>
                <p className="text-muted-foreground text-xs mt-2">Cluster is healthy</p>
                <Link to="/events" className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline">
                  View events
                  <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pod Status & Cluster Efficiency */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PodStatusDistribution />
        </div>
        <ClusterEfficiencyCard />
      </div>

      {/* Workloads Explorer */}
      <Card className="border-primary/10">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle>Workloads Explorer</CardTitle>
                <p className="text-xs text-muted-foreground">Detailed state of all workload controllers</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {selectedItems.size > 0 && (
                  <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-border bg-muted/30">
                    <span className="text-sm text-muted-foreground">{selectedItems.size} selected</span>
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => setSelectedItems(new Set())}>
                      Clear
                    </Button>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-9"
                  onClick={() => setShowTableFilters((v) => !v)}
                  aria-label={showTableFilters ? 'Hide table column filters' : 'Show table column filters'}
                >
                  {showTableFilters ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                  {showTableFilters ? 'Hide filters' : 'Show filters'}
                </Button>
                <ColumnVisibilityDropdown
                  columns={WORKLOADS_COLUMNS_FOR_VISIBILITY}
                  visibleColumns={columnVisibility.visibleColumns}
                  onToggle={columnVisibility.setColumnVisible}
                  ariaLabel="Toggle table columns"
                />
              </div>
            </div>
            {/* Global filters (search, clear, page size) - always visible */}
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
              <div className="flex items-center gap-2 bg-background border rounded-lg p-1.5 flex-1 min-w-[200px]">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  placeholder="Filter by name, namespace, kind..."
                  className="border-0 focus-visible:ring-0 h-8 flex-1"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search workloads"
                />
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="gap-1.5 h-8" onClick={clearAllFilters}>
                  <Filter className="h-3.5 w-3.5" />
                  Clear filters
                </Button>
              )}
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2 h-9">
                      {pageSize} per page
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <DropdownMenuItem
                        key={size}
                        onClick={() => handlePageSizeChange(size)}
                        className={cn(pageSize === size && 'bg-accent')}
                      >
                        {size} per page
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !data ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              Connect a cluster to explore workloads
            </div>
          ) : filteredWorkloads.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              {searchQuery || hasActiveFilters ? 'No workloads match your filter' : 'No workload controllers found'}
            </div>
          ) : (
            <TableFilterProvider value={showTableFilters}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground border-b-2 border-border uppercase text-[10px] font-bold tracking-wider">
                    <tr>
                      <th className="px-4 py-3 w-10">
                        <Checkbox
                          checked={isAllSelected}
                          onCheckedChange={toggleAll}
                          aria-label="Select all on page"
                          className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')}
                        />
                      </th>
                      {columnVisibility.isColumnVisible('kind') && (
                        <th className="px-6 py-3">
                          <TableColumnHeaderWithFilterAndSort
                            columnId="kind"
                            label="Kind"
                            sortKey={sortKey}
                            sortOrder={sortOrder}
                            onSort={(k) => setSort(k)}
                            filterable={false}
                            distinctValues={distinctValuesByColumn.kind ?? []}
                            selectedFilterValues={columnFilters.kind ?? new Set()}
                            onFilterChange={(col, vals) => setColumnFilter(col, vals)}
                          />
                        </th>
                      )}
                      {columnVisibility.isColumnVisible('name') && (
                        <th className="px-6 py-3">
                          <TableColumnHeaderWithFilterAndSort
                            columnId="name"
                            label="Name"
                            sortKey={sortKey}
                            sortOrder={sortOrder}
                            onSort={(k) => setSort(k)}
                            filterable={false}
                            distinctValues={[]}
                            selectedFilterValues={new Set()}
                            onFilterChange={() => { }}
                          />
                        </th>
                      )}
                      {columnVisibility.isColumnVisible('namespace') && (
                        <th className="px-6 py-3">
                          <TableColumnHeaderWithFilterAndSort
                            columnId="namespace"
                            label="Namespace"
                            sortKey={sortKey}
                            sortOrder={sortOrder}
                            onSort={(k) => setSort(k)}
                            filterable={false}
                            distinctValues={distinctValuesByColumn.namespace ?? []}
                            selectedFilterValues={columnFilters.namespace ?? new Set()}
                            onFilterChange={(col, vals) => setColumnFilter(col, vals)}
                          />
                        </th>
                      )}
                      {columnVisibility.isColumnVisible('status') && (
                        <th className="px-6 py-3">
                          <TableColumnHeaderWithFilterAndSort
                            columnId="status"
                            label="Status"
                            sortKey={sortKey}
                            sortOrder={sortOrder}
                            onSort={(k) => setSort(k)}
                            filterable={false}
                            distinctValues={distinctValuesByColumn.status ?? []}
                            selectedFilterValues={columnFilters.status ?? new Set()}
                            onFilterChange={(col, vals) => setColumnFilter(col, vals)}
                          />
                        </th>
                      )}
                      {columnVisibility.isColumnVisible('replicas') && (
                        <th className="px-6 py-3 text-right">
                          <TableColumnHeaderWithFilterAndSort
                            columnId="replicas"
                            label="Replicas"
                            sortKey={sortKey}
                            sortOrder={sortOrder}
                            onSort={(k) => setSort(k)}
                            filterable={false}
                            distinctValues={[]}
                            selectedFilterValues={new Set()}
                            onFilterChange={() => { }}
                          />
                        </th>
                      )}
                      {columnVisibility.isColumnVisible('pressure') && (
                        <th className="px-6 py-3 text-right">
                          <TableColumnHeaderWithFilterAndSort
                            columnId="pressure"
                            label="Pressure"
                            sortKey={sortKey}
                            sortOrder={sortOrder}
                            onSort={(k) => setSort(k)}
                            filterable={false}
                            distinctValues={distinctValuesByColumn.pressure ?? []}
                            selectedFilterValues={columnFilters.pressure ?? new Set()}
                            onFilterChange={(col, vals) => setColumnFilter(col, vals)}
                          />
                        </th>
                      )}
                    </tr>
                    {showTableFilters && (
                      <tr className="bg-muted/30 border-b-2 border-border">
                        <td className="px-4 py-2 w-10" />
                        {columnVisibility.isColumnVisible('kind') && (
                          <td className="px-6 py-2">
                            <TableFilterCell
                              columnId="kind"
                              label="Kind"
                              distinctValues={distinctValuesByColumn.kind ?? []}
                              selectedFilterValues={columnFilters.kind ?? new Set()}
                              onFilterChange={setColumnFilter}
                              valueCounts={valueCountsByColumn.kind}
                            />
                          </td>
                        )}
                        {columnVisibility.isColumnVisible('name') && <td className="px-6 py-2" />}
                        {columnVisibility.isColumnVisible('namespace') && (
                          <td className="px-6 py-2">
                            <TableFilterCell
                              columnId="namespace"
                              label="Namespace"
                              distinctValues={distinctValuesByColumn.namespace ?? []}
                              selectedFilterValues={columnFilters.namespace ?? new Set()}
                              onFilterChange={setColumnFilter}
                              valueCounts={valueCountsByColumn.namespace}
                            />
                          </td>
                        )}
                        {columnVisibility.isColumnVisible('status') && (
                          <td className="px-6 py-2">
                            <TableFilterCell
                              columnId="status"
                              label="Status"
                              distinctValues={distinctValuesByColumn.status ?? []}
                              selectedFilterValues={columnFilters.status ?? new Set()}
                              onFilterChange={setColumnFilter}
                              valueCounts={valueCountsByColumn.status}
                            />
                          </td>
                        )}
                        {columnVisibility.isColumnVisible('replicas') && <td className="px-6 py-2 text-right" />}
                        {columnVisibility.isColumnVisible('pressure') && (
                          <td className="px-6 py-2 text-right">
                            <TableFilterCell
                              columnId="pressure"
                              label="Pressure"
                              distinctValues={distinctValuesByColumn.pressure ?? []}
                              selectedFilterValues={columnFilters.pressure ?? new Set()}
                              onFilterChange={setColumnFilter}
                              valueCounts={valueCountsByColumn.pressure}
                            />
                          </td>
                        )}
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y">
                    {itemsOnPage.map((w, i) => {
                      const Icon = KIND_ICONS[w.kind] ?? Container;
                      const detailPath = getDetailPath(w.kind, w.name, w.namespace);
                      const statusColor = STATUS_COLORS[w.status] ?? 'bg-muted/50 text-muted-foreground';
                      const pressureColor = PRESSURE_COLORS[w.pressure] ?? 'text-muted-foreground';
                      const pressureLabel =
                        w.pressure === 'Low' || w.pressure === 'Normal' ? 'Normal' :
                          w.pressure === 'Medium' || w.pressure === 'Elevated' ? 'Elevated' :
                            w.pressure === 'Zero' || w.pressure === 'Idle' ? 'Idle' : w.pressure;
                      const key = getWorkloadKey(w);
                      const isSelected = selectedItems.has(key);

                      return (
                        <motion.tr
                          key={key}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.02 }}
                          className={cn('hover:bg-muted/30 transition-colors group', isSelected && 'bg-primary/5')}
                        >
                          <td className="px-4 py-4 w-10" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelection(w)}
                              aria-label={`Select ${w.name}`}
                            />
                          </td>
                          {columnVisibility.isColumnVisible('kind') && (
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-primary/5 text-primary">
                                  <Icon className="h-3.5 w-3.5" />
                                </div>
                                <span className="font-medium">{w.kind}</span>
                              </div>
                            </td>
                          )}
                          {columnVisibility.isColumnVisible('name') && (
                            <td className="px-6 py-4">
                              {detailPath ? (
                                <Link
                                  to={detailPath}
                                  className="font-medium text-primary hover:underline truncate block max-w-[200px]"
                                >
                                  {w.name}
                                </Link>
                              ) : (
                                <span className="font-medium truncate block max-w-[200px]">{w.name}</span>
                              )}
                            </td>
                          )}
                          {columnVisibility.isColumnVisible('namespace') && (
                            <td className="px-6 py-4 text-muted-foreground font-mono text-xs">
                              {w.namespace || '—'}
                            </td>
                          )}
                          {columnVisibility.isColumnVisible('status') && (
                            <td className="px-6 py-4">
                              <Badge variant="secondary" className={cn('border', statusColor)}>
                                {w.status}
                              </Badge>
                            </td>
                          )}
                          {columnVisibility.isColumnVisible('replicas') && (
                            <td className="px-6 py-4 text-right font-mono text-xs">
                              {w.desired > 0 ? `${w.ready}/${w.desired}` : '—'}
                            </td>
                          )}
                          {columnVisibility.isColumnVisible('pressure') && (
                            <td className="px-6 py-4 text-right">
                              <span className={cn('font-mono text-xs', pressureColor)}>
                                {pressureLabel}
                              </span>
                            </td>
                          )}
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex flex-wrap gap-2">
                  <ListPagination
                    rangeLabel={
                      totalFiltered > 0
                        ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
                        : 'No workloads'
                    }
                    hasPrev={safePageIndex > 0}
                    hasNext={start + pageSize < totalFiltered}
                    onPrev={() => setPageIndex((i) => Math.max(0, i - 1))}
                    onNext={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))}
                    currentPage={safePageIndex + 1}
                    totalPages={Math.max(1, totalPages)}
                    onPageChange={(p) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1)))}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/deployments" className="text-xs">
                      Deployments
                      <ChevronRight className="w-3 h-3 ml-1" />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/statefulsets" className="text-xs">
                      StatefulSets
                      <ChevronRight className="w-3 h-3 ml-1" />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/jobs" className="text-xs">
                      Jobs
                      <ChevronRight className="w-3 h-3 ml-1" />
                    </Link>
                  </Button>
                </div>
              </div>
            </TableFilterProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
