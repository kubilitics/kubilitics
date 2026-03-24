import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
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
    Equal,
    History,
    Upload,
    FileUp,
} from 'lucide-react';
import yaml from 'js-yaml';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkline } from './PodSparkline';
import { YamlViewer } from './YamlViewer';
import { getResource, getPodMetrics, getNodeMetrics, getPodLogsUrl } from '@/services/backendApiClient';
import { resourceToYaml } from '@/hooks/useK8sResourceDetail';
import { parseRawLogs, type LogEntry } from '@/lib/logParser';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { computeDiff, YamlLineContent, getIntraLineDiff, DiffLine } from './YamlDiffUtils';
import { useK8sResourceList, type KubernetesResource, type ResourceType } from '@/hooks/useKubernetes';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useThemeStore } from '@/stores/themeStore';

const LazyDiffEditor = lazy(() => import('@monaco-editor/react').then(m => ({ default: m.DiffEditor })));

/** Monaco DiffEditor wrapper with labels and diff stats */
function MonacoDiffView({ original, modified, originalLabel, modifiedLabel }: {
  original: string; modified: string; originalLabel: string; modifiedLabel: string;
}) {
  const { theme, resolvedTheme } = useThemeStore();
  const isDark = (theme === 'system' ? resolvedTheme : theme) === 'dark';

  // Compute diff stats
  const stats = useMemo(() => {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');
    const origSet = new Set(origLines);
    const modSet = new Set(modLines);
    const added = modLines.filter(l => !origSet.has(l)).length;
    const removed = origLines.filter(l => !modSet.has(l)).length;
    return { added, removed };
  }, [original, modified]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground">{originalLabel}</span>
          <span className="text-muted-foreground">→</span>
          <span className="text-sm font-semibold text-foreground">{modifiedLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {stats.added > 0 && <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs">+{stats.added} added</Badge>}
          {stats.removed > 0 && <Badge variant="outline" className="text-red-600 border-red-300 text-xs">-{stats.removed} removed</Badge>}
          {stats.added === 0 && stats.removed === 0 && <Badge variant="outline" className="text-xs">Identical</Badge>}
        </div>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <LazyDiffEditor
          original={original}
          modified={modified}
          language="yaml"
          theme={isDark ? 'vs-dark' : 'light'}
          height="65vh"
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
            lineNumbers: 'on',
            folding: true,
            wordWrap: 'off',
          }}
        />
      </div>
    </div>
  );
}

interface ResourceForComparison {
    name: string;
    namespace?: string;
    status: string;
    yaml: string;
    yamlLoading?: boolean;
    metrics?: {
        cpu: { data: number[]; value: string };
        memory: { data: number[]; value: string };
    };
    metricsLoading?: boolean;
    logEntries?: LogEntry[];
    logsLoading?: boolean;
    dataUnavailable?: boolean;
}

interface ResourceComparisonViewProps {
    resourceType: ResourceType;
    resourceKind: string; // "Pod", "Deployment", etc.
    namespace?: string;
    initialSelectedResources?: string[]; // "namespace/name" or "name"
    clusterId?: string;
    backendBaseUrl?: string;
    isConnected?: boolean;
    embedded?: boolean;
}

const UNAVAILABLE_METRICS = {
    cpu: { data: [] as number[], value: '—' },
    memory: { data: [] as number[], value: '—' },
};

function valueToSparklineData(value: string): number[] {
    const num = parseFloat(value.replace(/[^0-9.]/g, ''));
    if (Number.isNaN(num)) return Array.from({ length: 20 }, () => 0);
    return Array.from({ length: 20 }, () => num);
}

function YamlDiffView({
    leftName,
    rightName,
    leftYaml,
    rightYaml,
    leftLoading,
    rightLoading,
    embedded = false,
}: {
    leftName: string;
    rightName: string;
    leftYaml: string;
    rightYaml: string;
    leftLoading?: boolean;
    rightLoading?: boolean;
    embedded?: boolean;
}) {
    const diffLines = useMemo(() => {
        if (leftLoading || rightLoading || !leftYaml || !rightYaml) return [];
        const baseDiff = computeDiff(leftYaml, rightYaml);

        const processed: Array<unknown> = [];
        for (let i = 0; i < baseDiff.length; i++) {
            const current = baseDiff[i];
            const next = baseDiff[i + 1];

            if (current.type === 'removed' && next && next.type === 'added') {
                const { leftSegments, rightSegments } = getIntraLineDiff(current.content.left || '', next.content.right || '');
                processed.push({
                    ...current,
                    type: 'modified-removed',
                    segments: leftSegments,
                });
                processed.push({
                    ...next,
                    type: 'modified-added',
                    segments: rightSegments,
                });
                i++;
            } else {
                processed.push(current);
            }
        }
        return processed;
    }, [leftYaml, rightYaml, leftLoading, rightLoading]);

    const stats = useMemo(() => {
        return diffLines.reduce(
            (acc, line) => {
                if (line.type === 'added' || line.type === 'modified-added') acc.added++;
                else if (line.type === 'removed' || line.type === 'modified-removed') acc.removed++;
                else acc.unchanged++;
                return acc;
            },
            { added: 0, removed: 0, unchanged: 0 }
        );
    }, [diffLines]);

    if (leftLoading || rightLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-4" />
                <p>Loading YAML for diff...</p>
            </div>
        );
    }

    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < diffLines.length; i++) {
        const line = diffLines[i];
        if (line.type === 'unchanged') {
            rows.push({
                leftNum: line.lineNumber.left,
                leftContent: line.content.left,
                leftType: 'unchanged',
                rightNum: line.lineNumber.right,
                rightContent: line.content.right,
                rightType: 'unchanged'
            });
        } else if (line.type === 'removed' || line.type === 'modified-removed') {
            const next = diffLines[i + 1];
            if (next && (next.type === 'added' || next.type === 'modified-added')) {
                rows.push({
                    leftNum: line.lineNumber.left,
                    leftContent: line.content.left,
                    leftType: line.type,
                    leftSegments: line.segments,
                    rightNum: next.lineNumber.right,
                    rightContent: next.content.right,
                    rightType: next.type,
                    rightSegments: next.segments
                });
                i++;
            } else {
                rows.push({
                    leftNum: line.lineNumber.left,
                    leftContent: line.content.left,
                    leftType: line.type,
                    leftSegments: line.segments
                });
            }
        } else if (line.type === 'added' || line.type === 'modified-added') {
            rows.push({
                rightNum: line.lineNumber.right,
                rightContent: line.content.right,
                rightType: line.type,
                rightSegments: line.segments
            });
        }
    }

    const scrollClass = embedded ? "h-auto overflow-hidden" : "h-[75vh] max-h-[800px] overflow-auto";

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 sticky top-0 z-10 bg-background/95 backdrop-blur py-2">
                <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground font-medium">Differences:</span>
                    <Badge variant="outline" className="gap-1 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">
                        <Minus className="h-3 w-3" /> {stats.removed} removed
                    </Badge>
                    <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                        <Plus className="h-3 w-3" /> {stats.added} added
                    </Badge>
                </div>
            </div>

            <div className={cn("rounded-xl border border-border bg-card shadow-sm overflow-hidden", scrollClass)}>
                <table className="w-full border-collapse font-mono text-[13px] leading-relaxed table-fixed">
                    <thead className="sticky top-0 z-20 bg-muted/90 backdrop-blur border-b border-border shadow-sm">
                        <tr>
                            <th className="w-12 py-2 border-r border-border/10"></th>
                            <th className="px-4 py-2 text-left truncate">{leftName}</th>
                            <th className="w-12 py-2 border-l border-r border-border/10"></th>
                            <th className="px-4 py-2 text-left truncate">{rightName}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i} className="hover:bg-muted/5 transition-colors">
                                <td className={cn("w-12 text-right pr-2 text-[11px] select-none py-0.5", row.leftType?.includes('removed') ? "bg-red-500/15" : "bg-muted/10")}>{row.leftNum || ''}</td>
                                <td className={cn("px-3 py-0.5 whitespace-pre overflow-x-auto", row.leftType?.includes('removed') ? "bg-red-500/10" : "opacity-80")}>
                                    {row.leftContent != null ? <YamlLineContent line={row.leftContent} segments={row.leftSegments} /> : null}
                                </td>
                                <td className={cn("w-12 text-right pr-2 text-[11px] select-none py-0.5 border-l", row.rightType?.includes('added') ? "bg-emerald-500/15" : "bg-muted/10")}>{row.rightNum || ''}</td>
                                <td className={cn("px-3 py-0.5 whitespace-pre overflow-x-auto", row.rightType?.includes('added') ? "bg-emerald-500/10" : "opacity-80")}>
                                    {row.rightContent != null ? <YamlLineContent line={row.rightContent} segments={row.rightSegments} /> : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {rows.length === 0 && (
                    <div className="py-20 text-center text-muted-foreground bg-muted/5">
                        <Equal className="h-10 w-10 mx-auto mb-3 opacity-20" />
                        <p>No differences found.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export function ResourceComparisonView({
    resourceType,
    resourceKind,
    namespace,
    initialSelectedResources,
    clusterId,
    backendBaseUrl,
    isConnected = false,
    embedded = false,
}: ResourceComparisonViewProps) {
    const [selectedResources, setSelectedResources] = useState<string[]>(() => initialSelectedResources ?? []);
    const [activeTab, setActiveTab] = useState('yaml');
    const [compareMode, setCompareMode] = useState<'resources' | 'lastApplied' | 'customYaml'>('resources');
    const [customYaml, setCustomYaml] = useState<string>('');
    const fileInputRef = useState<HTMLInputElement | null>(null);

    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

    // canList: only requires backend + cluster (no WebSocket needed) — used for the Add dropdown
    const canList = Boolean(clusterId && isBackendConfigured() && backendBaseUrl);
    // canFetch: also requires live connection — used for YAML / metrics / logs queries
    const canFetch = Boolean(isConnected && clusterId && isBackendConfigured());

    const { data: listData } = useK8sResourceList<KubernetesResource>(resourceType, namespace, {
        limit: 500,
        enabled: canList,
    });

    const availableResources = useMemo(() => {
        return (listData?.items ?? []).map(item => ({
            name: item.metadata.name,
            namespace: item.metadata.namespace,
            status: (item.status?.phase as string) || (item.status?.conditions?.find((c: Record<string, unknown>) => c.type === 'Ready')?.status === 'True' ? 'Running' : 'Ready') || 'Unknown',
        }));
    }, [listData]);

    const resourceQueries = useQueries({
        queries: selectedResources.map(key => {
            const parts = key.split('/');
            const [ns, name] = parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
            return {
                queryKey: ['compare-resource', clusterId, resourceType, key],
                queryFn: async () => {
                    const raw = await getResource(backendBaseUrl!, clusterId!, resourceType, ns, name);
                    return resourceToYaml(raw as unknown as KubernetesResource);
                },
                enabled: canFetch && !!name,
            };
        }),
    });

    const metricsQueries = useQueries({
        queries: selectedResources.map(key => {
            if (resourceType !== 'pods' && resourceType !== 'nodes') return { queryKey: ['skip-metrics'], enabled: false };
            const parts = key.split('/');
            const [ns, name] = parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
            return {
                queryKey: ['compare-metrics', clusterId, resourceType, key],
                queryFn: () => resourceType === 'pods'
                    ? getPodMetrics(backendBaseUrl!, clusterId!, ns, name)
                    : getNodeMetrics(backendBaseUrl!, clusterId!, name),
                enabled: canFetch && !!name,
            };
        }),
    });

    const logsQueries = useQueries({
        queries: selectedResources.map(key => {
            if (resourceType !== 'pods') return { queryKey: ['skip-logs'], enabled: false };
            const parts = key.split('/');
            const [ns, name] = parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
            return {
                queryKey: ['compare-logs', clusterId, resourceType, key],
                queryFn: async () => {
                    const url = getPodLogsUrl(backendBaseUrl!, clusterId!, ns, name, { tail: 200, follow: false });
                    const res = await fetch(url);
                    if (!res.ok) throw new Error('Failed to fetch logs');
                    return res.text();
                },
                enabled: canFetch && !!name,
            };
        }),
    });

    const resourcesData: ResourceForComparison[] = useMemo(() => {
        return selectedResources.map((key, i) => {
            const parts = key.split('/');
            const [ns, name] = parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
            const res = availableResources.find(r => r.name === name && (ns === '' || r.namespace === ns));

            const yaml = resourceQueries[i]?.data;
            const m = metricsQueries[i]?.data as { CPU?: string; Memory?: string } | undefined;
            const logText = logsQueries[i]?.data as string | undefined;

            return {
                name,
                namespace: ns,
                status: res?.status || 'Unknown',
                yaml: canFetch && yaml ? yaml : '',
                yamlLoading: canFetch && resourceQueries[i]?.isLoading,
                metrics: canFetch && m ? {
                    cpu: { data: valueToSparklineData(m.CPU ?? '0'), value: m.CPU ?? '—' },
                    memory: { data: valueToSparklineData(m.Memory ?? '0'), value: m.Memory ?? '—' },
                } : (resourceType === 'pods' || resourceType === 'nodes' ? UNAVAILABLE_METRICS : undefined),
                metricsLoading: canFetch && metricsQueries[i]?.isLoading,
                logEntries: canFetch && logText != null ? parseRawLogs(logText) : undefined,
                logsLoading: canFetch && logsQueries[i]?.isLoading,
                dataUnavailable: !canFetch,
            };
        });
    }, [selectedResources, availableResources, canFetch, resourceQueries, metricsQueries, logsQueries, resourceType]);

    const handleAdd = (key: string) => {
        if (selectedResources.length >= 4) {
            toast.error('Maximum 4 resources can be compared');
            return;
        }
        if (!selectedResources.includes(key)) {
            setSelectedResources([...selectedResources, key]);
        }
    };

    const hasMetrics = resourceType === 'pods' || resourceType === 'nodes';
    const hasLogs = resourceType === 'pods';

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
                <div className="flex items-center gap-3">
                    <GitCompare className="h-5 w-5 text-primary" />
                    <div>
                        <h2 className="text-lg font-semibold">{resourceKind} Comparison</h2>
                        <p className="text-sm text-muted-foreground">Compare resources side-by-side</p>
                    </div>
                </div>
            </div>

            <div className="px-6 py-3 border-b bg-muted/10 flex items-center gap-3">
                <Select onValueChange={handleAdd}>
                    <SelectTrigger className="w-64"><SelectValue placeholder={`Add ${resourceKind}...`} /></SelectTrigger>
                    <SelectContent>
                        {availableResources
                            .filter(r => !selectedResources.includes(r.namespace ? `${r.namespace}/${r.name}` : r.name))
                            .map(r => (
                                <SelectItem key={r.namespace ? `${r.namespace}/${r.name}` : r.name} value={r.namespace ? `${r.namespace}/${r.name}` : r.name}>
                                    {r.name} {r.namespace && `(${r.namespace})`}
                                </SelectItem>
                            ))}
                    </SelectContent>
                </Select>
                <div className="flex items-center gap-2 overflow-x-auto">
                    {selectedResources.map(key => (
                        <Badge key={key} variant="secondary" className="gap-1.5">
                            {key.split('/').pop()}
                            <button onClick={() => setSelectedResources(selectedResources.filter(k => k !== key))} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                        </Badge>
                    ))}
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                <div className="px-6 py-2 border-b">
                    <TabsList>
                        <TabsTrigger value="yaml"><FileText className="h-4 w-4 mr-2" /> YAML</TabsTrigger>
                        {hasMetrics && <TabsTrigger value="metrics"><Activity className="h-4 w-4 mr-2" /> Metrics</TabsTrigger>}
                        {hasLogs && <TabsTrigger value="logs"><ScrollText className="h-4 w-4 mr-2" /> Logs</TabsTrigger>}
                    </TabsList>
                </div>

                <TabsContent value="yaml" className="flex-1 overflow-hidden">
                    {/* Compare mode selector */}
                    <div className="px-6 py-3 border-b flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">Mode:</span>
                      <div className="inline-flex items-center rounded-lg bg-muted/40 p-0.5 gap-0.5">
                        <button onClick={() => setCompareMode('resources')} className={cn('px-3 py-1 rounded-md text-xs font-medium transition-all', compareMode === 'resources' ? 'bg-white dark:bg-slate-700 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                          <GitCompare className="h-3 w-3 inline mr-1" /> Resources
                        </button>
                        <button onClick={() => setCompareMode('lastApplied')} className={cn('px-3 py-1 rounded-md text-xs font-medium transition-all', compareMode === 'lastApplied' ? 'bg-white dark:bg-slate-700 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                          <History className="h-3 w-3 inline mr-1" /> Live vs Last Applied
                        </button>
                        <button onClick={() => setCompareMode('customYaml')} className={cn('px-3 py-1 rounded-md text-xs font-medium transition-all', compareMode === 'customYaml' ? 'bg-white dark:bg-slate-700 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                          <Upload className="h-3 w-3 inline mr-1" /> Custom YAML
                        </button>
                      </div>
                    </div>

                    <ScrollArea className="h-full px-6 py-4">
                      {/* Mode: Resources (existing behavior) */}
                      {compareMode === 'resources' && (
                        <>
                          {resourcesData.length < 2 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                <GitCompare className="h-12 w-12 mb-4 opacity-50" />
                                <p>Select at least 2 resources to compare</p>
                            </div>
                          ) : resourcesData.length === 2 ? (
                            <Suspense fallback={<Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />}>
                              <MonacoDiffView
                                originalLabel={resourcesData[0].name}
                                modifiedLabel={resourcesData[1].name}
                                original={resourcesData[0].yaml}
                                modified={resourcesData[1].yaml}
                              />
                            </Suspense>
                          ) : (
                            <div className={cn("grid gap-4", resourcesData.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
                                {resourcesData.map(res => (
                                    <Card key={res.name}>
                                        <CardHeader className="py-2"><CardTitle className="text-sm truncate">{res.name}</CardTitle></CardHeader>
                                        <CardContent className="p-0">
                                            <div className="h-80 overflow-auto">
                                                {res.yamlLoading ? <Loader2 className="h-6 w-6 animate-spin m-4" /> : <YamlViewer yaml={res.yaml} resourceName={res.name} editable={false} />}
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                          )}
                        </>
                      )}

                      {/* Mode: Live vs Last Applied */}
                      {compareMode === 'lastApplied' && (() => {
                        const firstResource = resourcesData[0];
                        if (!firstResource) return (
                          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <History className="h-12 w-12 mb-4 opacity-50" />
                            <p>Select a resource above to compare live vs last-applied</p>
                          </div>
                        );
                        // Extract last-applied-configuration annotation from raw resource
                        // Parse the YAML to extract the last-applied-configuration annotation
                        let lastAppliedJson: string | undefined;
                        try {
                          const parsed = yaml.load(firstResource.yaml) as Record<string, unknown>;
                          const meta = parsed?.metadata as Record<string, unknown>;
                          const ann = meta?.annotations as Record<string, string>;
                          lastAppliedJson = ann?.['kubectl.kubernetes.io/last-applied-configuration'];
                        } catch { /* parse failed */ }
                        if (!lastAppliedJson) return (
                          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <History className="h-12 w-12 mb-4 opacity-50" />
                            <p className="font-medium">No last-applied configuration</p>
                            <p className="text-xs mt-2 max-w-md text-center">This resource wasn't applied via <code className="bg-muted px-1 rounded">kubectl apply</code>. The last-applied annotation is only set when using declarative management.</p>
                          </div>
                        );
                        let lastAppliedYaml = '';
                        try {
                          const parsed = JSON.parse(lastAppliedJson);
                          lastAppliedYaml = resourceToYaml(parsed);
                        } catch { lastAppliedYaml = '# Failed to parse last-applied-configuration'; }
                        // Clean live YAML: strip managedFields and status for cleaner diff
                        let liveYaml = firstResource.yaml;
                        try {
                          const liveObj = yaml.load(liveYaml) as Record<string, unknown>;
                          if (liveObj?.metadata) {
                            const meta = liveObj.metadata as Record<string, unknown>;
                            delete meta.managedFields;
                            delete meta.resourceVersion;
                            delete meta.uid;
                            delete meta.creationTimestamp;
                            delete meta.generation;
                            if (meta.annotations) {
                              const ann = { ...(meta.annotations as Record<string, string>) };
                              delete ann['kubectl.kubernetes.io/last-applied-configuration'];
                              meta.annotations = Object.keys(ann).length > 0 ? ann : undefined;
                            }
                          }
                          delete liveObj.status;
                          liveYaml = yaml.dump(liveObj, { indent: 2, noRefs: true, lineWidth: -1 });
                        } catch { /* use raw */ }
                        return (
                          <Suspense fallback={<Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />}>
                            <MonacoDiffView
                              originalLabel="Last Applied (kubectl apply)"
                              modifiedLabel="Live Cluster State"
                              original={lastAppliedYaml}
                              modified={liveYaml}
                            />
                          </Suspense>
                        );
                      })()}

                      {/* Mode: Custom YAML */}
                      {compareMode === 'customYaml' && (() => {
                        const firstResource = resourcesData[0];
                        const clusterYaml = firstResource?.yaml || '';
                        return (
                          <div className="space-y-4">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium text-foreground/70">Paste or upload your YAML to compare against <strong>{firstResource?.name || 'selected resource'}</strong></span>
                              <label className="cursor-pointer">
                                <input
                                  type="file"
                                  accept=".yaml,.yml,.json"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const reader = new FileReader();
                                      reader.onload = (ev) => {
                                        const text = ev.target?.result as string;
                                        try {
                                          // Normalize: parse then dump to ensure consistent formatting
                                          const parsed = yaml.load(text);
                                          setCustomYaml(yaml.dump(parsed, { indent: 2, noRefs: true, lineWidth: -1 }));
                                          toast.success(`Loaded ${file.name}`);
                                        } catch {
                                          setCustomYaml(text);
                                          toast.warning('File loaded but YAML parsing failed — showing raw content');
                                        }
                                      };
                                      reader.readAsText(file);
                                    }
                                    e.target.value = '';
                                  }}
                                />
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer">
                                  <FileUp className="h-3.5 w-3.5" /> Upload YAML
                                </span>
                              </label>
                            </div>
                            {!customYaml ? (
                              <div className="border-2 border-dashed border-border/50 rounded-xl p-8">
                                <textarea
                                  className="w-full h-64 font-mono text-xs bg-transparent border-none outline-none resize-none text-foreground placeholder:text-muted-foreground/50"
                                  placeholder="Paste your YAML here..."
                                  value={customYaml}
                                  onChange={(e) => setCustomYaml(e.target.value)}
                                />
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge variant="outline" className="text-xs">Custom YAML loaded</Badge>
                                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setCustomYaml('')}>Clear</Button>
                                </div>
                                <Suspense fallback={<Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />}>
                                  <MonacoDiffView
                                    originalLabel={firstResource?.name || 'Cluster Resource'}
                                    modifiedLabel="Custom YAML"
                                    original={clusterYaml}
                                    modified={customYaml}
                                  />
                                </Suspense>
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </ScrollArea>
                </TabsContent>

                {hasMetrics && (
                    <TabsContent value="metrics" className="flex-1 overflow-auto p-6">
                        <div className="space-y-6">
                            <Card>
                                <CardHeader><CardTitle className="text-sm">CPU Usage</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                        {resourcesData.map(res => (
                                            <div key={res.name} className="p-4 bg-muted/30 rounded-lg">
                                                <div className="flex justify-between mb-2">
                                                    <span className="text-sm font-medium truncate">{res.name}</span>
                                                    <Badge variant="secondary">{res.metrics?.cpu.value}</Badge>
                                                </div>
                                                {res.metrics && <Sparkline data={res.metrics.cpu.data} width={200} height={40} color="hsl(var(--primary))" showLive />}
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="text-sm">Memory Usage</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                        {resourcesData.map(res => (
                                            <div key={res.name} className="p-4 bg-muted/30 rounded-lg">
                                                <div className="flex justify-between mb-2">
                                                    <span className="text-sm font-medium truncate">{res.name}</span>
                                                    <Badge variant="secondary">{res.metrics?.memory.value}</Badge>
                                                </div>
                                                {res.metrics && <Sparkline data={res.metrics.memory.data} width={200} height={40} color="hsl(var(--primary))" showLive />}
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>
                )}

                {hasLogs && (
                    <TabsContent value="logs" className="flex-1 overflow-auto p-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
                            {resourcesData.map(res => (
                                <Card key={res.name} className="flex flex-col overflow-hidden min-h-[400px]">
                                    <CardHeader className="py-2"><CardTitle className="text-sm">{res.name} Logs</CardTitle></CardHeader>
                                    <CardContent className="flex-1 bg-zinc-950 text-zinc-100 p-0 overflow-auto font-mono text-xs">
                                        {res.logsLoading ? (
                                            <div className="p-4"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading logs...</div>
                                        ) : (
                                            <div className="p-4">
                                                {res.logEntries?.map((entry, idx) => (
                                                    <div key={idx} className="mb-1">
                                                        <span className="text-zinc-500 mr-2">{entry.timestamp}</span>
                                                        <span className={cn(entry.level === 'error' ? 'text-red-400' : 'text-zinc-200')}>{entry.message}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
