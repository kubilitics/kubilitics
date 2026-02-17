import { useState, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { 
  X, 
  GitCompare, 
  FileText, 
  Activity, 
  ScrollText,
  Download,
  Loader2,
  Plus,
  Minus,
  Copy,
  Columns2,
  ListFilter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkline } from './PodSparkline';
import { YamlViewer } from './YamlViewer';
import { computeDiff } from './YamlCompareViewer';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getResource, getPodMetrics, getPodLogsUrl } from '@/services/backendApiClient';
import { resourceToYaml } from '@/hooks/useK8sResourceDetail';
import { parseRawLogs, levelColors, type LogEntry } from '@/lib/logParser';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

interface PodForComparison {
  name: string;
  namespace: string;
  status: string;
  yaml: string;
  yamlLoading?: boolean;
  metrics: {
    cpu: { data: number[]; value: string };
    memory: { data: number[]; value: string };
  };
  metricsLoading?: boolean;
  logEntries: LogEntry[];
  logsLoading?: boolean;
  /** True when cluster is not connected so YAML/metrics/logs are empty */
  dataUnavailable?: boolean;
}

interface PodComparisonViewProps {
  open: boolean;
  onClose: () => void;
  availablePods: Array<{ name: string; namespace: string; status: string }>;
  clusterId?: string;
  backendBaseUrl?: string;
  isConnected?: boolean;
}

const UNAVAILABLE_METRICS = {
  cpu: { data: [] as number[], value: '—' },
  memory: { data: [] as number[], value: '—' },
};

/** Build sparkline data from current metric value (backend returns point-in-time; no history). Flat line = current value. */
function valueToSparklineData(value: string): number[] {
  const num = parseFloat(value.replace(/[^0-9.]/g, ''));
  if (Number.isNaN(num)) return Array.from({ length: 20 }, () => 0);
  return Array.from({ length: 20 }, () => num);
}

interface YamlDiffViewProps {
  leftName: string;
  rightName: string;
  leftYaml: string;
  rightYaml: string;
  leftLoading?: boolean;
  rightLoading?: boolean;
  onSwitchToSideBySide: () => void;
}

function YamlDiffView({
  leftName,
  rightName,
  leftYaml,
  rightYaml,
  leftLoading,
  rightLoading,
  onSwitchToSideBySide,
}: YamlDiffViewProps) {
  const diffLines = useMemo(() => {
    if (leftLoading || rightLoading || !leftYaml || !rightYaml) return [];
    return computeDiff(leftYaml, rightYaml);
  }, [leftYaml, rightYaml, leftLoading, rightLoading]);

  const stats = useMemo(() => {
    return diffLines.reduce(
      (acc, line) => {
        if (line.type === 'added') acc.added++;
        else if (line.type === 'removed') acc.removed++;
        else acc.unchanged++;
        return acc;
      },
      { added: 0, removed: 0, unchanged: 0 }
    );
  }, [diffLines]);

  const handleCopyDiff = () => {
    const diffText = diffLines
      .map(line => {
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        const content = line.content.right ?? line.content.left ?? '';
        return `${prefix} ${content}`;
      })
      .join('\n');
    navigator.clipboard.writeText(diffText);
    toast.success('Diff copied to clipboard');
  };

  const handleDownloadDiff = () => {
    const diffText = diffLines
      .map(line => {
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        const content = line.content.right ?? line.content.left ?? '';
        return `${prefix} ${content}`;
      })
      .join('\n');
    const blob = new Blob([diffText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pod-diff-${leftName}-vs-${rightName}.patch`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Diff downloaded');
  };

  if (leftLoading || rightLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>Loading YAML for diff...</p>
      </div>
    );
  }

  if (!leftYaml && !rightYaml) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm text-center px-4">
        <FileText className="h-8 w-8 mb-4 opacity-50" />
        <p>Connect cluster to view YAML and compare.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onSwitchToSideBySide}
          >
            <Columns2 className="h-4 w-4" />
            Side-by-side
          </Button>
          <Badge variant="outline" className="gap-1 text-primary border-primary/30">
            <Plus className="h-3 w-3" />
            {stats.added}
          </Badge>
          <Badge variant="outline" className="gap-1 text-destructive border-destructive/30">
            <Minus className="h-3 w-3" />
            {stats.removed}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyDiff} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" />
            Copy diff
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadDiff} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Download diff
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Left: <span className="font-medium text-foreground">{leftName}</span>
        {' · '}
        Right: <span className="font-medium text-foreground">{rightName}</span>
      </p>
      <div className="rounded-lg border border-border/80 bg-muted/5 overflow-hidden">
        <ScrollArea className="h-[min(70vh,520px)]">
          <div className="font-mono text-xs">
            {diffLines.map((line, i) => {
              const content = line.content.right ?? line.content.left ?? '';
              const leftNum = line.lineNumber?.left;
              const rightNum = line.lineNumber?.right;
              return (
                <div
                  key={i}
                  className={cn(
                    'flex items-start border-b border-border/40 last:border-b-0 min-h-[22px]',
                    line.type === 'removed' && 'bg-destructive/10 border-l-4 border-l-destructive',
                    line.type === 'added' && 'bg-[hsl(var(--success))/0.15] border-l-4 border-l-[hsl(var(--success))]',
                    line.type === 'unchanged' && 'bg-background'
                  )}
                >
                  <div className="shrink-0 w-24 flex justify-end gap-2 pr-2 py-0.5 text-muted-foreground tabular-nums select-none border-r border-border/40">
                    <span className="w-8 text-right">{leftNum ?? ''}</span>
                    <span className="w-8 text-right">{rightNum ?? ''}</span>
                  </div>
                  <pre className="flex-1 overflow-x-auto py-0.5 px-3 whitespace-pre break-all text-foreground">
                    {content || '\n'}
                  </pre>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export function PodComparisonView({
  open,
  onClose,
  availablePods,
  clusterId,
  backendBaseUrl,
  isConnected = false,
}: PodComparisonViewProps) {
  const [selectedPods, setSelectedPods] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('yaml');
  /** When exactly 2 pods: 'side-by-side' | 'diff' */
  const [yamlViewMode, setYamlViewMode] = useState<'side-by-side' | 'diff'>('side-by-side');

  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  // backendBaseUrl can be '' in dev proxy mode; use isBackendConfigured for fetch eligibility
  const canFetch = Boolean(isConnected && clusterId && isBackendConfigured());

  const resourceQueries = useQueries({
    queries: selectedPods.map(podKey => {
      const [namespace, name] = podKey.split('/');
      return {
        queryKey: ['compare-pod-resource', clusterId, podKey],
        queryFn: async () => {
          const raw = await getResource(backendBaseUrl!, clusterId!, 'pods', namespace || '', name || '');
          return resourceToYaml(raw as import('@/hooks/useKubernetes').KubernetesResource);
        },
        enabled: canFetch && !!namespace && !!name,
      };
    }),
  });

  const metricsQueries = useQueries({
    queries: selectedPods.map(podKey => {
      const [namespace, name] = podKey.split('/');
      return {
        queryKey: ['compare-pod-metrics', clusterId, podKey],
        queryFn: () => getPodMetrics(backendBaseUrl!, clusterId!, namespace || '', name || ''),
        enabled: canFetch && !!namespace && !!name,
      };
    }),
  });

  const logsQueries = useQueries({
    queries: selectedPods.map(podKey => {
      const [namespace, name] = podKey.split('/');
      return {
        queryKey: ['compare-pod-logs', clusterId, podKey],
        queryFn: async () => {
          const url = getPodLogsUrl(backendBaseUrl!, clusterId!, namespace || '', name || '', {
            tail: 200,
            follow: false,
          });
          const res = await fetch(url);
          if (!res.ok) throw new Error('Failed to fetch logs');
          return res.text();
        },
        enabled: canFetch && !!namespace && !!name,
      };
    }),
  });

  const podsData: PodForComparison[] = useMemo(() => {
    return selectedPods.map((podKey, i) => {
      const [namespace, name] = podKey.split('/');
      const pod = availablePods.find(p => p.name === name && p.namespace === namespace);
      const res = resourceQueries[i]?.data;
      const resLoading = resourceQueries[i]?.isLoading;
      const m = metricsQueries[i]?.data as { CPU?: string; Memory?: string } | undefined;
      const mLoading = metricsQueries[i]?.isLoading;
      const logText = logsQueries[i]?.data as string | undefined;
      const logLoading = logsQueries[i]?.isLoading;

      const cpuVal = m?.CPU ?? '—';
      const memVal = m?.Memory ?? '—';
      const metrics =
        canFetch && m
          ? {
              cpu: { data: valueToSparklineData(cpuVal), value: cpuVal },
              memory: { data: valueToSparklineData(memVal), value: memVal },
            }
          : UNAVAILABLE_METRICS;

      return {
        name: name || '',
        namespace: namespace || '',
        status: pod?.status || 'Unknown',
        yaml: canFetch && res ? res : '',
        yamlLoading: canFetch && resLoading,
        metrics,
        metricsLoading: canFetch && mLoading,
        logEntries: canFetch && logText != null ? parseRawLogs(logText) : [],
        logsLoading: canFetch && logLoading,
        dataUnavailable: !canFetch,
      };
    });
  }, [
    selectedPods,
    availablePods,
    canFetch,
    resourceQueries,
    metricsQueries,
    logsQueries,
  ]);

  const handleAddPod = (podKey: string) => {
    if (selectedPods.length >= 4) {
      toast.error('Maximum 4 pods can be compared at once');
      return;
    }
    if (!selectedPods.includes(podKey)) {
      setSelectedPods([...selectedPods, podKey]);
    }
  };

  const handleRemovePod = (podKey: string) => {
    setSelectedPods(selectedPods.filter(p => p !== podKey));
  };

  const handleExportComparison = () => {
    const comparison = {
      timestamp: new Date().toISOString(),
      pods: podsData.map(p => ({
        name: p.name,
        namespace: p.namespace,
        status: p.status,
        yaml: p.yaml,
        metrics: {
          cpu: p.metrics.cpu.value,
          memory: p.metrics.memory.value,
        },
        logs: p.logEntries.map(e => `${e.timestamp} [${e.level.toUpperCase()}] ${e.message}`).join('\n'),
      })),
    };
    const blob = new Blob([JSON.stringify(comparison, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pod-comparison.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Comparison exported');
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-7xl max-h-[90vh] flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <GitCompare className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Pod Comparison</h2>
              <p className="text-sm text-muted-foreground">
                Compare YAML, metrics, and logs side-by-side
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportComparison} disabled={podsData.length < 2}>
              <Download className="h-4 w-4 mr-1.5" />
              Export
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Pod Selection */}
        <div className="px-6 py-3 border-b bg-muted/10">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Select pods to compare:</span>
            <Select onValueChange={handleAddPod}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Add pod..." />
              </SelectTrigger>
              <SelectContent>
                {availablePods
                  .filter(p => !selectedPods.includes(`${p.namespace}/${p.name}`))
                  .map(pod => (
                    <SelectItem key={`${pod.namespace}/${pod.name}`} value={`${pod.namespace}/${pod.name}`}>
                      <span className="font-medium">{pod.name}</span>
                      <span className="text-muted-foreground ml-2">({pod.namespace})</span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 flex-1 overflow-x-auto">
              {selectedPods.map(podKey => {
                const [namespace, name] = podKey.split('/');
                return (
                  <Badge key={podKey} variant="secondary" className="gap-1.5 shrink-0">
                    {name}
                    <button onClick={() => handleRemovePod(podKey)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-2 border-b">
            <TabsList className="bg-muted/60 p-1 rounded-xl border border-border/80">
              <TabsTrigger
                value="yaml"
                className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:ring-2 data-[state=active]:ring-primary data-[state=active]:shadow-sm rounded-lg transition-all duration-200"
              >
                <FileText className="h-4 w-4" />
                YAML
              </TabsTrigger>
              <TabsTrigger
                value="metrics"
                className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:ring-2 data-[state=active]:ring-primary data-[state=active]:shadow-sm rounded-lg transition-all duration-200"
              >
                <Activity className="h-4 w-4" />
                Metrics
              </TabsTrigger>
              <TabsTrigger
                value="logs"
                className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:ring-2 data-[state=active]:ring-primary data-[state=active]:shadow-sm rounded-lg transition-all duration-200"
              >
                <ScrollText className="h-4 w-4" />
                Logs
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-hidden">
            <TabsContent value="yaml" className="h-full m-0">
              <ScrollArea className="h-full">
                <div className="p-6">
                  {podsData.length < 2 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                      <GitCompare className="h-12 w-12 mb-4 opacity-50" />
                      <p>Select at least 2 pods to compare</p>
                    </div>
                  ) : podsData.length === 2 && yamlViewMode === 'diff' ? (
                    <YamlDiffView
                      leftName={podsData[0].name}
                      rightName={podsData[1].name}
                      leftYaml={podsData[0].yaml}
                      rightYaml={podsData[1].yaml}
                      leftLoading={podsData[0].yamlLoading}
                      rightLoading={podsData[1].yamlLoading}
                      onSwitchToSideBySide={() => setYamlViewMode('side-by-side')}
                    />
                  ) : (
                    <>
                      {podsData.length === 2 && (
                        <div className="flex items-center justify-between gap-4 mb-4">
                          <div className="flex rounded-xl border border-border/80 bg-muted/60 p-1 shadow-sm">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                'gap-1.5 rounded-lg transition-all duration-200',
                                yamlViewMode === 'side-by-side'
                                  ? 'bg-primary/10 text-primary ring-2 ring-primary shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
                              )}
                              onClick={() => setYamlViewMode('side-by-side')}
                            >
                              <Columns2 className="h-4 w-4" />
                              Side-by-side
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                'gap-1.5 rounded-lg transition-all duration-200',
                                yamlViewMode === 'diff'
                                  ? 'bg-primary/10 text-primary ring-2 ring-primary shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
                              )}
                              onClick={() => setYamlViewMode('diff')}
                            >
                              <ListFilter className="h-4 w-4" />
                              Show differences
                            </Button>
                          </div>
                          {yamlViewMode === 'side-by-side' && (
                            <p className="text-xs text-muted-foreground">
                              Switch to &quot;Show differences&quot; to see a line-by-line diff.
                            </p>
                          )}
                        </div>
                      )}
                      {podsData.length >= 3 && (
                        <p className="text-xs text-muted-foreground mb-4">
                          Diff view is available when comparing exactly 2 pods.
                        </p>
                      )}
                      <div className={cn(
                        'grid gap-4',
                        podsData.length === 2 && 'grid-cols-2',
                        podsData.length === 3 && 'grid-cols-3',
                        podsData.length >= 4 && 'grid-cols-4'
                      )}>
                        {podsData.map((pod) => (
                          <Card key={`${pod.namespace}/${pod.name}`}>
                            <CardHeader className="py-3">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-medium truncate">{pod.name}</CardTitle>
                                <NamespaceBadge namespace={pod.namespace} className="text-xs" />
                              </div>
                            </CardHeader>
                            <CardContent className="p-0">
                              <div className="h-80 min-h-[320px]">
                                {pod.yamlLoading ? (
                                  <div className="flex items-center justify-center h-full text-muted-foreground">
                                    <Loader2 className="h-6 w-6 animate-spin" />
                                  </div>
                                ) : pod.dataUnavailable || !pod.yaml ? (
                                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm px-4 text-center">
                                    <FileText className="h-8 w-8 mb-2 opacity-50" />
                                    Connect cluster to view YAML
                                  </div>
                                ) : (
                                  <YamlViewer
                                    yaml={pod.yaml}
                                    resourceName={pod.name}
                                    editable={false}
                                  />
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="metrics" className="h-full m-0">
              <ScrollArea className="h-full">
                <div className="p-6">
                  {podsData.length < 2 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                      <Activity className="h-12 w-12 mb-4 opacity-50" />
                      <p>Select at least 2 pods to compare metrics</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* CPU Comparison */}
                      <Card>
                        <CardHeader className="py-3">
                          <CardTitle className="text-sm">CPU Usage</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className={cn(
                            'grid gap-4',
                            podsData.length === 2 && 'grid-cols-2',
                            podsData.length === 3 && 'grid-cols-3',
                            podsData.length >= 4 && 'grid-cols-4'
                          )}>
                            {podsData.map(pod => (
                              <div key={`${pod.namespace}/${pod.name}-cpu`} className="p-4 rounded-lg bg-muted/30">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm font-medium truncate">{pod.name}</span>
                                  {pod.metricsLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                  ) : (
                                    <Badge variant="secondary">{pod.metrics.cpu.value}</Badge>
                                  )}
                                </div>
                                {pod.dataUnavailable && !pod.metricsLoading ? (
                                  <div className="flex items-center justify-center h-10 text-muted-foreground text-xs">
                                    Connect cluster to view metrics
                                  </div>
                                ) : !pod.metricsLoading && pod.metrics.cpu.data.length > 0 ? (
                                  <Sparkline 
                                    data={pod.metrics.cpu.data} 
                                    width={200} 
                                    height={40}
                                    color="hsl(var(--primary))"
                                    showLive
                                  />
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Memory Comparison */}
                      <Card>
                        <CardHeader className="py-3">
                          <CardTitle className="text-sm">Memory Usage</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className={cn(
                            'grid gap-4',
                            podsData.length === 2 && 'grid-cols-2',
                            podsData.length === 3 && 'grid-cols-3',
                            podsData.length >= 4 && 'grid-cols-4'
                          )}>
                            {podsData.map(pod => (
                              <div key={`${pod.namespace}/${pod.name}-mem`} className="p-4 rounded-lg bg-muted/30">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm font-medium truncate">{pod.name}</span>
                                  {pod.metricsLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                  ) : (
                                    <Badge variant="secondary">{pod.metrics.memory.value}</Badge>
                                  )}
                                </div>
                                {pod.dataUnavailable && !pod.metricsLoading ? (
                                  <div className="flex items-center justify-center h-10 text-muted-foreground text-xs">
                                    Connect cluster to view metrics
                                  </div>
                                ) : !pod.metricsLoading && pod.metrics.memory.data.length > 0 ? (
                                  <Sparkline 
                                    data={pod.metrics.memory.data} 
                                    width={200} 
                                    height={40}
                                    color="hsl(142, 76%, 36%)"
                                    showLive
                                  />
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="logs" className="h-full m-0">
              <ScrollArea className="h-full">
                <div className="p-6">
                  {podsData.length < 2 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                      <ScrollText className="h-12 w-12 mb-4 opacity-50" />
                      <p>Select at least 2 pods to compare logs</p>
                    </div>
                  ) : (
                    <div className={cn(
                      'grid gap-4',
                      podsData.length === 2 && 'grid-cols-2',
                      podsData.length === 3 && 'grid-cols-3',
                      podsData.length >= 4 && 'grid-cols-4'
                    )}>
                      {podsData.map(pod => (
                        <Card key={`${pod.namespace}/${pod.name}-logs`}>
                          <CardHeader className="py-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm font-medium truncate">{pod.name}</CardTitle>
                              <NamespaceBadge namespace={pod.namespace} className="text-xs" />
                            </div>
                          </CardHeader>
                          <CardContent className="p-0">
                            <ScrollArea className="h-80">
                              <div className="p-4 space-y-0.5 font-mono text-xs bg-muted/30">
                                {pod.logsLoading ? (
                                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                  </div>
                                ) : pod.dataUnavailable || pod.logEntries.length === 0 ? (
                                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm px-4 text-center">
                                    <ScrollText className="h-8 w-8 mb-2 opacity-50" />
                                    {pod.dataUnavailable ? 'Connect cluster to view logs' : 'No log entries'}
                                  </div>
                                ) : (
                                  pod.logEntries.map((entry, i) => (
                                    <div
                                      key={i}
                                      className={cn('py-0.5 break-all', levelColors[entry.level] ?? '')}
                                    >
                                      {entry.timestamp && <span className="text-muted-foreground mr-2">{entry.timestamp}</span>}
                                      {entry.message}
                                    </div>
                                  ))
                                )}
                              </div>
                            </ScrollArea>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </motion.div>
    </motion.div>
  );
}
