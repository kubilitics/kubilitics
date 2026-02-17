/**
 * Cluster Connect Page
 * Entry point for the Kubilitics application (Desktop & Helm modes).
 * Uses backend cluster list when configured; no mock data.
 */
import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Upload,
  Server,
  Zap,
  ArrowRight,
  Check,
  Loader2,
  AlertCircle,
  RefreshCw,
  Monitor,
  Cloud,
  Terminal,
  Folder,
  CheckCircle2,
  XCircle,
  Circle,
  Settings,
} from 'lucide-react';
import { KubernetesLogo } from '@/components/icons/KubernetesIcons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { DEFAULT_BACKEND_BASE_URL } from '@/lib/backendConstants';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useDiscoverClusters } from '@/hooks/useDiscoverClusters';
import { addCluster, addClusterWithUpload, type BackendCluster } from '@/services/backendApiClient';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { WelcomeAddCluster } from '@/components/connect/WelcomeAddCluster';

interface DetectedCluster {
  id: string;
  name: string;
  context: string;
  server: string;
  status: 'checking' | 'healthy' | 'unhealthy' | 'unknown';
  namespace?: string;
  isCurrent?: boolean;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

function mapBackendStatus(s?: string): DetectedCluster['status'] {
  if (s === 'connected') return 'healthy';
  if (s === 'disconnected') return 'unhealthy';
  return 'unknown';
}

function backendToDetected(b: BackendCluster): DetectedCluster {
  const server = b.server_url ?? b.server ?? '';
  return {
    id: b.id,
    name: b.name,
    context: b.context,
    server,
    status: mapBackendStatus(b.status),
    isCurrent: b.is_current,
  };
}

// Common kubeconfig locations (informational only when backend is used)
const kubeconfigLocations = [
  { path: '~/.kube/config', desc: 'Default location' },
  { path: '~/.config/k3s/k3s.yaml', desc: 'K3s config' },
  { path: '$KUBECONFIG', desc: 'Environment variable' },
  { path: '~/.kube/config.d/*', desc: 'Config directory' },
];

export default function ClusterConnect() {
  const navigate = useNavigate();
  const { activeCluster, setActiveCluster, setClusters, setDemo, appMode } = useClusterStore();
  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const queryClient = useQueryClient();
  const clustersFromBackend = useClustersFromBackend();
  const discoveredClustersRes = useDiscoverClusters();

  const [tabMode, setTabMode] = useState<'auto' | 'upload'>('auto');
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isAddingDiscovered, setIsAddingDiscovered] = useState<string | null>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleUploadedFile(file);
  }, []);

  // If no mode selected yet, redirect to selection
  useEffect(() => {
    if (!appMode) {
      navigate('/', { replace: true });
    }
  }, [appMode, navigate]);

  // Already connected (e.g. from persist): redirect to dashboard
  useEffect(() => {
    if (activeCluster) {
      navigate('/dashboard', { replace: true });
    }
  }, [activeCluster, navigate]);

  // Clusters from backend API
  const registeredClusters: DetectedCluster[] =
    isBackendConfigured && clustersFromBackend.data
      ? clustersFromBackend.data.map(backendToDetected)
      : [];

  // Discovered (not yet registered) clusters
  const discoveredClusters: DetectedCluster[] =
    isBackendConfigured && discoveredClustersRes.data
      ? discoveredClustersRes.data.map(backendToDetected)
      : [];

  const handleUploadedFile = async (file: File) => {
    if (!isBackendConfigured || !backendBaseUrl?.trim()) {
      toast.error('Set backend URL in Settings first');
      return;
    }
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const bytes = await file.arrayBuffer();
      setUploadProgress(30);
      const base64 = btoa(
        new Uint8Array(bytes).reduce((acc, b) => acc + String.fromCharCode(b), '')
      );
      setUploadProgress(60);
      const text = new TextDecoder().decode(bytes);
      let contextName = 'default';
      try {
        const currentMatch = text.match(/current-context:\s*(\S+)/);
        if (currentMatch) contextName = currentMatch[1].trim();
        else {
          const nameMatch = text.match(/contexts:\s*[\s\S]*?name:\s*(\S+)/);
          if (nameMatch) contextName = nameMatch[1].trim();
        }
      } catch {
        /* use default */
      }
      setUploadProgress(80);
      await addClusterWithUpload(backendBaseUrl, base64, contextName);
      setUploadProgress(100);
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
      clustersFromBackend.refetch();
      discoveredClustersRes.refetch();
      toast.success('Cluster added', { description: `Context: ${contextName}` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleAddDiscovered = async (cluster: DetectedCluster) => {
    if (!isBackendConfigured || !backendBaseUrl) return;
    setIsAddingDiscovered(cluster.name);
    try {
      await addCluster(backendBaseUrl, '', cluster.context); // Empty path uses default on backend
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
      await clustersFromBackend.refetch();
      await discoveredClustersRes.refetch();
      toast.success('Cluster registered', { description: `Context: ${cluster.context}` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to register cluster');
    } finally {
      setIsAddingDiscovered(null);
    }
  };

  const handleConnect = (cluster: DetectedCluster) => {
    if (!isBackendConfigured || !clustersFromBackend.data) return;
    const backendItem = clustersFromBackend.data.find((c) => c.id === cluster.id || c.context === cluster.context);
    if (!backendItem) return;
    setIsConnecting(true);
    const connectedClusters = clustersFromBackend.data.map(backendClusterToCluster);
    const connectedCluster = backendClusterToCluster(backendItem);
    setCurrentClusterId(backendItem.id);
    setClusters(connectedClusters);
    setActiveCluster(connectedCluster);
    setDemo(false);
    setIsConnecting(false);
    queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
    clustersFromBackend.refetch();
    toast.success(`Connected to ${cluster.name}`, { description: `Context: ${cluster.context}` });
    navigate('/home', { replace: true });
  };

  const handleDemoMode = () => {
    setDemo(true);
    navigate('/dashboard', { replace: true });
  };

  const getStatusIcon = (status: DetectedCluster['status'] | 'detected') => {
    switch (status) {
      case 'checking':
        return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />;
      case 'healthy':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'unhealthy':
        return <XCircle className="h-4 w-4 text-rose-500" />;
      case 'detected':
        return <Monitor className="h-4 w-4 text-blue-400" />;
      default:
        return <Circle className="h-4 w-4 text-slate-500" />;
    }
  };

  const handleRefreshClusters = () => {
    queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
    clustersFromBackend.refetch();
    discoveredClustersRes.refetch();
  };

  if (activeCluster) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#020617] text-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
          <p className="text-slate-400 font-medium">Initializing Workspace…</p>
        </div>
      </div>
    );
  }

  // Specialized view for In-Cluster mode
  if (appMode === 'in-cluster') {
    return (
      <div className="min-h-screen bg-[#020617] text-slate-50 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl text-center">
          <div className="p-4 rounded-2xl bg-purple-500/10 w-fit mx-auto mb-8">
            <Cloud className="h-10 w-10 text-purple-400" />
          </div>
          <h1 className="text-3xl font-bold mb-4 tracking-tight">In-Cluster Connection</h1>
          <p className="text-slate-400 mb-10 leading-relaxed">
            Kubilitics is running inside your cluster. We'll use the pod's service account to discover resources automatically.
          </p>

          <Card className="bg-slate-900/50 border-slate-800 p-8 mb-8 backdrop-blur-xl">
            <div className="flex items-center gap-4 text-left mb-6">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="text-emerald-400" />
              </div>
              <div>
                <p className="font-semibold">Service Account Detected</p>
                <p className="text-xs text-slate-500">Automatically authenticated via kubernetes.default.svc</p>
              </div>
            </div>

            <Button
              onClick={() => handleConnect({
                id: 'in-cluster',
                name: 'In-Cluster',
                context: 'service-account',
                server: 'kubernetes.default.svc',
                status: 'healthy'
              })}
              className="w-full bg-purple-600 hover:bg-purple-500 h-12 text-base font-medium"
            >
              Initialize In-Cluster Access
              <ArrowRight className="ml-2" size={18} />
            </Button>
          </Card>

          <button onClick={() => navigate('/')} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            Go back to mode selection
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-slate-50 flex">
      <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
        <motion.div
          initial="hidden"
          animate="show"
          variants={container}
          className="w-full max-w-2xl py-12"
        >
          <motion.div variants={item} className="text-center mb-10">
            <div className="flex items-center justify-center gap-3 mb-6">
              <KubernetesLogo size={56} className="text-blue-500" />
              <span className="text-4xl font-bold tracking-tight">Kubilitics</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mb-3">
              Connect Your Cluster
            </h1>
            <p className="text-slate-400 max-w-md mx-auto">
              Choose how you'd like to connect to your Kubernetes environment.
            </p>
          </motion.div>

          <motion.div variants={item}>
            <Tabs value={tabMode} onValueChange={(v) => setTabMode(v as typeof tabMode)} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-8 bg-slate-900/50 border-slate-800 p-1">
                <TabsTrigger value="auto" className="gap-2 text-slate-400 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                  <Zap className="h-4 w-4" />
                  Auto-Detect
                </TabsTrigger>
                <TabsTrigger value="upload" className="gap-2 text-slate-400 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                  <Upload className="h-4 w-4" />
                  Upload Config
                </TabsTrigger>
              </TabsList>

              <TabsContent value="auto" className="mt-0">
                <Card className="p-6 bg-slate-900/40 border-slate-800/50 backdrop-blur-xl">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="font-semibold text-lg text-slate-100">Local Environments</h3>
                      <p className="text-sm text-slate-500">
                        {isBackendConfigured
                          ? (clustersFromBackend.isLoading || discoveredClustersRes.isLoading)
                            ? 'Scanning for local clusters…'
                            : 'Registered and detected contexts from ~/.kube/config'
                          : 'Set backend URL in Settings to see clusters'}
                      </p>
                    </div>
                    {isBackendConfigured && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-slate-400 hover:text-white"
                        onClick={handleRefreshClusters}
                        disabled={clustersFromBackend.isFetching || discoveredClustersRes.isFetching}
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${clustersFromBackend.isFetching || discoveredClustersRes.isFetching ? 'animate-spin' : ''}`}
                        />
                      </Button>
                    )}
                  </div>

                  {isBackendConfigured && (clustersFromBackend.error || discoveredClustersRes.error) && registeredClusters.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400"
                    >
                      <AlertCircle className="h-5 w-5 shrink-0" />
                      <span className="text-sm font-medium">Connection failed. Ensure the desktop engine is running.</span>
                    </motion.div>
                  )}

                  {!isBackendConfigured && (
                    <div className="text-center py-12">
                      <Settings className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                      <p className="text-slate-400 mb-6 max-w-xs mx-auto">
                        Configure the Kubilitics backend URL in Settings to see your clusters.
                      </p>
                      <Button variant="outline" className="border-slate-700 hover:bg-slate-800" onClick={() => navigate('/settings')}>
                        Open Settings
                      </Button>
                    </div>
                  )}

                  {isBackendConfigured && (clustersFromBackend.isLoading || discoveredClustersRes.isLoading) && (
                    <div className="space-y-3 mb-4">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-16 bg-slate-800/40 animate-pulse rounded-xl" />
                      ))}
                    </div>
                  )}

                  {isBackendConfigured && !clustersFromBackend.isLoading && !discoveredClustersRes.isLoading && (
                    <div className="space-y-4">
                      {/* Registered Clusters */}
                      {registeredClusters.map((cluster) => (
                        <motion.div
                          key={cluster.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`
                            group p-4 rounded-xl border transition-all cursor-pointer
                            ${selectedClusterId === cluster.id
                              ? 'border-blue-500/50 bg-blue-500/5'
                              : 'border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-800/60'}
                            ${cluster.status === 'unhealthy' ? 'opacity-70' : ''}
                          `}
                          onClick={() => setSelectedClusterId(cluster.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg ${cluster.status === 'healthy' ? 'bg-emerald-500/10' : 'bg-slate-800'}`}>
                                {getStatusIcon(cluster.status)}
                              </div>
                              <div>
                                <p className="font-medium text-slate-100">{cluster.name}</p>
                                <p className="text-xs text-slate-500 font-mono tracking-wider">
                                  {cluster.server || 'LOCAL ENGINE'}
                                </p>
                              </div>
                              {cluster.isCurrent && (
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-none ml-2">Active</Badge>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant={cluster.status === 'unhealthy' ? 'outline' : 'default'}
                              className={cluster.status === 'healthy' ? 'bg-blue-600 hover:bg-blue-500 text-white' : ''}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConnect(cluster);
                              }}
                              disabled={isConnecting}
                            >
                              {isConnecting && selectedClusterId === cluster.id ? (
                                <Loader2 className="h-4 w-4 animate-spin text-white" />
                              ) : (
                                <>
                                  {cluster.status === 'unhealthy' ? 'Try Connect' : 'Connect'}
                                  <ArrowRight className="h-4 w-4 ml-1.5 transition-transform group-hover:translate-x-1" />
                                </>
                              )}
                            </Button>
                          </div>
                        </motion.div>
                      ))}

                      {/* Discovered (New) Clusters */}
                      {discoveredClusters.map((cluster) => (
                        <motion.div
                          key={cluster.name}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="group p-4 rounded-xl border border-blue-500/20 bg-blue-500/[0.02] border-dashed hover:border-blue-500/40 hover:bg-blue-500/[0.04] transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="p-2 rounded-lg bg-blue-500/10">
                                <Monitor className="h-4 w-4 text-blue-400" />
                              </div>
                              <div>
                                <p className="font-medium text-blue-100">{cluster.name}</p>
                                <p className="text-xs text-blue-500/60">New local context detected</p>
                              </div>
                              {cluster.isCurrent && (
                                <Badge className="bg-blue-500/20 text-blue-400 border-none ml-2">Active</Badge>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
                              onClick={() => handleAddDiscovered(cluster)}
                              disabled={isAddingDiscovered === cluster.name}
                            >
                              {isAddingDiscovered === cluster.name ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  Register Context
                                  <Zap className="h-4 w-4 ml-1.5" />
                                </>
                              )}
                            </Button>
                          </div>
                        </motion.div>
                      ))}

                      {registeredClusters.length === 0 && discoveredClusters.length === 0 && (
                        <div className="text-center py-12">
                          <AlertCircle className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                          <p className="text-slate-400 mb-6">
                            No clusters registered or found in default locations.
                          </p>
                          <div className="flex gap-3 justify-center">
                            <Button variant="outline" className="border-slate-800 hover:bg-slate-800" onClick={() => setTabMode('upload')}>
                              Upload Kubeconfig
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="upload" className="mt-0">
                <Card className="p-1 bg-slate-900/40 border-slate-800/50 backdrop-blur-xl">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="relative rounded-xl border-2 border-dashed border-slate-800 p-12 text-center hover:border-blue-500/50 hover:bg-blue-500/[0.02] transition-all"
                  >
                    {isUploading ? (
                      <div className="space-y-4">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
                        <p className="font-medium text-slate-200">Processing Kubeconfig…</p>
                        <div className="w-48 h-1.5 bg-slate-800 rounded-full mx-auto overflow-hidden">
                          <motion.div
                            className="h-full bg-blue-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="p-4 rounded-2xl bg-blue-500/10 w-fit mx-auto mb-6">
                          <Upload className="h-8 w-8 text-blue-400" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">Drop your Kubeconfig</h3>
                        <p className="text-sm text-slate-500 mb-6 max-w-xs mx-auto">
                          Upload your cluster credentials to register them with the backend.
                        </p>
                        <label className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors cursor-pointer">
                          Select File
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && handleUploadedFile(e.target.files[0])}
                          />
                        </label>
                      </>
                    )}
                  </div>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="mt-8 pt-8 border-t border-slate-800/50 flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 text-xs text-slate-500 uppercase tracking-widest font-semibold">
                <div className="h-[1px] w-8 bg-slate-800" />
                <span>Alternate Options</span>
                <div className="h-[1px] w-8 bg-slate-800" />
              </div>
              <div className="flex gap-4">
                <Button
                  variant="ghost"
                  className="text-slate-400 hover:text-white hover:bg-slate-800/50"
                  onClick={handleDemoMode}
                >
                  Explore Demo Mode
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  className="text-slate-400 hover:text-white hover:bg-slate-800/50"
                  onClick={() => navigate('/settings')}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Backend Settings
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Side Panel (Desktop only) */}
      <div className="hidden xl:flex w-[400px] bg-slate-900/30 border-l border-slate-800/50 p-12 flex-col justify-between">
        <div>
          <div className="p-3 rounded-2xl bg-blue-500/10 w-fit mb-8">
            <Monitor className="h-6 w-6 text-blue-500" />
          </div>
          <h2 className="text-2xl font-bold mb-4">Desktop OS Engine</h2>
          <p className="text-slate-400 leading-relaxed mb-10">
            Kubilitics Desktop runs as your local Kubernetes control center, providing deep visibility and management for all your clusters.
          </p>

          <div className="space-y-6">
            {[
              { icon: Zap, title: 'Instant Discovery', text: 'Auto-detects Docker Desktop, orbstack, and local contexts.' },
              { icon: Server, title: 'Multi-Cluster', text: 'Switch between production and local dev in real-time.' },
              { icon: CheckCircle2, title: 'Private & Secure', text: 'All credentials remain stored in your local engine.' },
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + i * 0.1 }}
                className="flex gap-4"
              >
                <div className="mt-1">
                  <feature.icon className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-slate-200">{feature.title}</p>
                  <p className="text-sm text-slate-500">{feature.text}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-blue-500/5 border border-blue-500/10">
          <div className="flex items-center gap-3 mb-3">
            <Badge className="bg-blue-500/20 text-blue-400 border-none">BETA</Badge>
            <span className="text-sm font-medium">Version 0.2.1-emergent</span>
          </div>
          <p className="text-xs text-slate-500">
            Proudly open source and community driven. Build the future of cloud-native together.
          </p>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
