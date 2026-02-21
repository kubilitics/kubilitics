/**
 * ResourceTopologyTab Component
 * Displays resource-scoped topology for a specific Kubernetes resource
 * Uses TopologyCanvas from topology-engine
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Network, ZoomIn, ZoomOut, Maximize, RotateCcw, Loader2, AlertCircle,
  Layers, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  TopologyCanvas,
  TopologyViewer,
  ABSTRACTION_LEVELS,
  NODE_COLORS,
  getKindColor,
  type TopologyCanvasRef,
  type TopologyNode,
  type KubernetesKind,
  type HealthStatus,
  type RelationshipType,
  type AbstractionLevel,
} from '@/topology-engine';
import { useResourceTopology } from '@/hooks/useResourceTopology';
import { buildTopologyNodeId, normalizeKindForTopology, isClusterScoped } from '@/utils/resourceKindMapper';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

// ─── Resource type filter config ──────────────────────────────
const RESOURCE_TYPES: Array<{ kind: KubernetesKind; label: string; color: string }> = [
  { kind: 'Namespace', label: 'Namespace', color: NODE_COLORS.Namespace.bg },
  { kind: 'Ingress', label: 'Ingress', color: NODE_COLORS.Ingress.bg },
  { kind: 'Service', label: 'Service', color: NODE_COLORS.Service.bg },
  { kind: 'Deployment', label: 'Deployment', color: NODE_COLORS.Deployment.bg },
  { kind: 'StatefulSet', label: 'StatefulSet', color: NODE_COLORS.StatefulSet.bg },
  { kind: 'DaemonSet', label: 'DaemonSet', color: NODE_COLORS.DaemonSet.bg },
  { kind: 'ReplicaSet', label: 'ReplicaSet', color: NODE_COLORS.ReplicaSet.bg },
  { kind: 'Pod', label: 'Pod', color: NODE_COLORS.Pod.bg },
  { kind: 'PodGroup', label: 'PodGroup', color: NODE_COLORS.PodGroup.bg },
  { kind: 'ConfigMap', label: 'ConfigMap', color: NODE_COLORS.ConfigMap.bg },
  { kind: 'Secret', label: 'Secret', color: NODE_COLORS.Secret.bg },
  { kind: 'PersistentVolumeClaim', label: 'PVC', color: NODE_COLORS.PersistentVolumeClaim.bg },
  { kind: 'PersistentVolume', label: 'PV', color: NODE_COLORS.PersistentVolume.bg },
  { kind: 'StorageClass', label: 'StorageClass', color: NODE_COLORS.StorageClass.bg },
  { kind: 'Node', label: 'Node', color: NODE_COLORS.Node.bg },
  { kind: 'Job', label: 'Job', color: NODE_COLORS.Job.bg },
  { kind: 'CronJob', label: 'CronJob', color: NODE_COLORS.CronJob.bg },
];

const ALL_RELATIONSHIPS: RelationshipType[] = [
  'owns', 'selects', 'scheduled_on', 'routes', 'references',
  'configures', 'mounts', 'stores', 'contains', 'exposes', 'backed_by',
  'permits', 'limits', 'manages',
];

interface ResourceTopologyTabProps {
  kind: string;
  namespace?: string;
  name: string;
  clusterId?: string;
}

export function ResourceTopologyTab({
  kind,
  namespace,
  name,
  clusterId: propClusterId,
}: ResourceTopologyTabProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<TopologyCanvasRef>(null);
  const activeClusterId = useActiveClusterId();
  const clusterId = propClusterId || activeClusterId;

  const normalizedKind = normalizeKindForTopology(kind ?? '');
  const nodeId = buildTopologyNodeId(normalizedKind, namespace || '', name || '');

  const [abstractionLevel, setAbstractionLevel] = useState<AbstractionLevel>('L2');
  const [selectedResources, setSelectedResources] = useState<Set<KubernetesKind>>(
    () => new Set(RESOURCE_TYPES.map(r => r.kind))
  );
  const [selectedRelationships, setSelectedRelationships] = useState<Set<RelationshipType>>(
    () => new Set(ALL_RELATIONSHIPS)
  );
  const [selectedHealth, setSelectedHealth] = useState<Set<HealthStatus | 'pending'>>(
    () => new Set(['healthy', 'warning', 'critical', 'unknown'])
  );
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [activeTab, setActiveTab] = useState<'standard'>('standard');

  const { graph, isLoading, error, refetch } = useResourceTopology({
    kind: normalizedKind,
    namespace: namespace ?? undefined,
    name: name ?? undefined,
    enabled: !!clusterId && !!kind && !!name,
  });

  const handleNodeDoubleClick = useCallback((node: TopologyNode) => {
    const routeMap: Record<string, string> = {
      Pod: 'pods',
      Deployment: 'deployments',
      ReplicaSet: 'replicasets',
      StatefulSet: 'statefulsets',
      DaemonSet: 'daemonsets',
      Service: 'services',
      ConfigMap: 'configmaps',
      Secret: 'secrets',
      Ingress: 'ingresses',
      IngressClass: 'ingressclasses',
      Node: 'nodes',
      Namespace: 'namespaces',
      PersistentVolume: 'persistentvolumes',
      PersistentVolumeClaim: 'persistentvolumeclaims',
      StorageClass: 'storageclasses',
      Job: 'jobs',
      CronJob: 'cronjobs',
      Endpoints: 'endpoints',
      EndpointSlice: 'endpointslices',
      NetworkPolicy: 'networkpolicies',
      VolumeAttachment: 'volumeattachments',
    };
    const route = routeMap[node.kind];
    if (route) {
      if (isClusterScoped(node.kind) || !node.namespace) {
        navigate(`/${route}/${node.name}`);
      } else {
        navigate(`/${route}/${node.namespace}/${node.name}`);
      }
    }
  }, [navigate]);

  const handleRefresh = useCallback(async () => {
    refetch();
    toast.success('Topology refreshed');
  }, [refetch]);

  // Parameter validation - after all hooks
  if (!kind || !name) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Missing required parameters: kind and name are required to load topology.
        </AlertDescription>
      </Alert>
    );
  }

  if (!clusterId) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <p>Please select a cluster to view topology for this resource.</p>
        </AlertDescription>
      </Alert>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <div className="space-y-2">
            <p>Failed to load topology: {error.message}</p>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // Empty state
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return (
      <Card className="p-8">
        <div className="text-center space-y-4">
          <Network className="h-12 w-12 mx-auto text-muted-foreground" />
          <div>
            <h3 className="text-lg font-semibold">No Topology Data</h3>
            <p className="text-sm text-muted-foreground mt-1">
              No relationships found for this resource.
            </p>
          </div>
          <Button variant="outline" onClick={handleRefresh}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full gap-3"
    >
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-100 dark:bg-blue-900 rounded-lg">
            <Network className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Relationship Map</h3>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === 'standard' && (
            <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded-lg">
              {(['L0', 'L1', 'L2', 'L3'] as AbstractionLevel[]).map((level) => (
                <Tooltip key={level}>
                  <TooltipTrigger asChild>
                    <Button
                      variant={abstractionLevel === level ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setAbstractionLevel(level)}
                      className="h-8 px-3 text-xs font-medium"
                    >
                      {level}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">{ABSTRACTION_LEVELS[level].label}</p>
                    <p className="text-xs text-muted-foreground">{ABSTRACTION_LEVELS[level].description}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={handleRefresh}>
            <RotateCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>



      <div className="flex-1 relative min-h-[600px] mt-2">
        <div className="h-full m-0 p-0">
          {activeTab === 'standard' && (
            <>
              <TopologyCanvas
                ref={canvasRef}
                graph={graph}
                selectedResources={selectedResources}
                selectedRelationships={selectedRelationships}
                selectedHealth={selectedHealth}
                searchQuery=""
                abstractionLevel={abstractionLevel}
                namespace={namespace}
                centeredNodeId={nodeId}
                isPaused={false}
                heatMapMode="none"
                trafficFlowEnabled={false}
                onNodeSelect={setSelectedNode}
                onNodeDoubleClick={handleNodeDoubleClick}
                className="h-full"
              />

              {/* Standard zoom controls for standard tab */}
              <div className="absolute top-4 right-4 flex flex-col gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80" onClick={() => canvasRef.current?.zoomIn()}>
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Zoom In</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80" onClick={() => canvasRef.current?.zoomOut()}>
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Zoom Out</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80" onClick={() => canvasRef.current?.fitToScreen()}>
                      <Maximize className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Fit</TooltipContent>
                </Tooltip>
              </div>

              {/* Premium Legend Panel (mirrored from main Topology page) */}
              <div className="absolute bottom-4 left-4 z-50 p-4 shadow-2xl border-none bg-white/90 backdrop-blur-md dark:bg-slate-900/90 rounded-xl w-72 overflow-hidden transition-all duration-300 hover:w-80">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1 bg-blue-100 dark:bg-blue-900 rounded-md">
                    <Network className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h4 className="font-bold text-[11px] tracking-tight text-slate-800 dark:text-slate-100 uppercase">Resource Legend</h4>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                  {[
                    { kind: 'Deployment', label: 'Deployment', color: NODE_COLORS.Deployment.bg },
                    { kind: 'ReplicaSet', label: 'ReplicaSet', color: NODE_COLORS.ReplicaSet.bg },
                    { kind: 'Pod', label: 'Pod', color: NODE_COLORS.Pod.bg },
                    { kind: 'Service', label: 'Service', color: NODE_COLORS.Service.bg },
                    { kind: 'Ingress', label: 'Ingress', color: NODE_COLORS.Ingress.bg },
                    { kind: 'ConfigMap', label: 'ConfigMap', color: NODE_COLORS.ConfigMap.bg },
                    { kind: 'Node', label: 'Node', color: NODE_COLORS.Node.bg },
                    { kind: 'PersistentVolumeClaim', label: 'PVC', color: NODE_COLORS.PersistentVolumeClaim.bg },
                  ].map(rt => (
                    <div key={rt.kind} className="flex items-center gap-1.5 group cursor-default">
                      <div
                        className="w-1.5 h-1.5 rounded-full shadow-sm group-hover:scale-125 transition-transform"
                        style={{ backgroundColor: rt.color }}
                      />
                      <span className="text-[9px] font-medium text-slate-500 dark:text-slate-400 truncate">{rt.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Shared Selected Node Panel */}
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="absolute top-4 left-4 w-72 z-10"
          >
            <Card className="p-4 bg-background/95 backdrop-blur-sm shadow-lg border-primary/30">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-md"
                  style={{ backgroundColor: getKindColor(selectedNode.kind) }}
                >
                  {selectedNode.kind.substring(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold truncate text-sm">{selectedNode.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedNode.kind}{selectedNode.namespace && ` • ${selectedNode.namespace}`}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="font-medium capitalize">{selectedNode.computed?.health ?? 'unknown'}</span>
                </div>
                {selectedNode.computed?.restartCount !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Restarts:</span>
                    <span className="font-medium">{selectedNode.computed.restartCount}</span>
                  </div>
                )}
                {selectedNode.computed?.cpuUsage !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">CPU:</span>
                    <span className="font-medium">{selectedNode.computed.cpuUsage}%</span>
                  </div>
                )}
                {selectedNode.computed?.replicas && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Replicas:</span>
                    <span className="font-medium">
                      {selectedNode.computed.replicas.ready}/{selectedNode.computed.replicas.desired}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-end">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => handleNodeDoubleClick(selectedNode)}>
                  View Details →
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
