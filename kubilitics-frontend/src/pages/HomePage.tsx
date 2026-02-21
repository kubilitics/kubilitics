import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  LayoutGrid,
  RefreshCw,
  Plus,
  Loader2,
  Zap,
  Focus,
  Activity,
  ShieldCheck,
  Bot,
  ChevronRight,
  PlusCircle,
  AlertCircle,
  Info,
  CheckCircle2,
  Settings,
  ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { useProjectStore } from '@/stores/projectStore';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useClusterOverview } from '@/hooks/useClusterOverview';
import { HealthRing } from '@/components/HealthRing';
import { AISetupModal } from '@/features/ai/AISetupModal';
import { loadLLMProviderConfig } from '@/services/aiService';
import { getProjects } from '@/services/backendApiClient';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'infrastructure';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchQuery, setSearchQuery] = useState('');

  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = useMemo(() => getEffectiveBackendBaseUrl(storedBackendUrl), [storedBackendUrl]);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const setActiveCluster = useClusterStore((s) => s.setActiveCluster);

  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [settingsProject, setSettingsProject] = useState<any>(null);
  const aiConfig = loadLLMProviderConfig();
  const isAiEnabled = !!(aiConfig && aiConfig.provider && aiConfig.provider !== ('none' as any));

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const clearActiveProject = useProjectStore((s) => s.clearActiveProject);
  useEffect(() => {
    if (activeTab !== 'projects') {
      clearActiveProject();
    }
  }, [activeTab, clearActiveProject]);

  const { data: clustersFromBackend } = useClustersFromBackend();
  const clusters = useMemo(() => clustersFromBackend || [], [clustersFromBackend]);

  const circuitOpen = useBackendCircuitOpen();
  const currentClusterId = useActiveClusterId();
  const { data: overview } = useClusterOverview(currentClusterId ?? undefined);
  const { data: projectsFromBackend, isLoading: isProjectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => getProjects(backendBaseUrl),
    enabled: isBackendConfigured && !circuitOpen,
  });
  const projects = useMemo(() => projectsFromBackend || [], [projectsFromBackend]);

  const filteredClusters = useMemo(() => {
    return clusters.filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.provider?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [clusters, searchQuery]);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    setSearchParams({ tab: val });
  };

  const systemHealthScore = overview?.health?.score;
  const activeClusters = clusters.length;
  const activeNodes = useMemo(() => clusters.reduce((acc, c) => acc + (c.node_count || 0), 0), [clusters]);

  return (
    <div className="min-h-screen bg-[#FBFDFF] pb-24">
      {/* Premium Glass Header */}
      <div className="bg-white/80 backdrop-blur-2xl sticky top-0 z-40 border-b border-slate-100 px-10 py-5 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Infrastructure Hub</h1>
            <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider -mt-0.5">Fleet Control & Governance</span>
          </div>
          <nav className="flex items-center p-1 bg-slate-100/60 rounded-xl border border-slate-200/50">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "rounded-lg h-8 px-5 text-xs font-semibold transition-all duration-200",
                activeTab === 'infrastructure'
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : "text-slate-500 hover:text-slate-900"
              )}
              onClick={() => handleTabChange('infrastructure')}
            >
              Infrastructure
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "rounded-lg h-8 px-5 text-xs font-semibold transition-all duration-200",
                activeTab === 'intelligence'
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : "text-slate-500 hover:text-slate-900"
              )}
              onClick={() => handleTabChange('intelligence')}
            >
              Intelligence
            </Button>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            <input
              type="text"
              placeholder="Filter ecosystem..."
              className="w-72 h-10 bg-slate-100/80 border border-transparent rounded-xl pl-12 pr-4 text-sm font-medium focus:bg-white focus:border-slate-200 focus:ring-4 focus:ring-blue-500/5 transition-all outline-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="h-8 w-[1px] bg-slate-200" />
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-10 px-5 text-sm font-bold flex items-center gap-2 shadow-lg shadow-blue-500/10 active:scale-95 transition-all"
            onClick={() => navigate('/setup/kubeconfig')}
          >
            <Plus className="h-4 w-4" />
            Add Cluster
          </Button>
        </div>
      </div>

      <div className="max-w-[1500px] mx-auto px-10 py-12">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-16">

          {/* INFRASTRUCTURE HUB */}
          <TabsContent value="infrastructure" className="m-0 space-y-24">

            {/* HERO STATS OVERVIEW */}
            <section className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div className="col-span-1 md:col-span-2 bg-[#F0F4FF] border border-blue-100 rounded-[2.5rem] p-10 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-12 opacity-5 scale-150 group-hover:rotate-12 transition-transform duration-1000">
                  <LayoutGrid className="h-32 w-32 text-blue-600" />
                </div>
                <div>
                  <Badge className="bg-blue-600/10 text-blue-700 border-none px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-6">
                    Fleet Overview
                  </Badge>
                  <h2 className="text-4xl font-bold text-slate-900 leading-tight tracking-tight">
                    Enterprise-Grade <span className="text-blue-700">Compute Fleet</span>
                  </h2>
                </div>
                <div className="flex gap-12 mt-12">
                  <div>
                    <div className="text-3xl font-bold text-slate-900 tracking-tight">{activeClusters}</div>
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-1">Clusters</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-slate-900 tracking-tight">{activeNodes}</div>
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-1">Total Nodes</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-blue-700 tracking-tight">{systemHealthScore}%</div>
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-1">Global Health</div>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-100 rounded-[2.5rem] p-10 shadow-sm flex flex-col items-center justify-center text-center group">
                <HealthRing score={systemHealthScore ?? 0} size={100} strokeWidth={10} />
                <div className="mt-6">
                  <div className="text-lg font-bold text-slate-900">Operational Health</div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mt-1">Zero Interruptions</p>
                </div>
              </div>

              <div className="bg-slate-900 rounded-[2.5rem] p-10 flex flex-col justify-between group cursor-pointer hover:shadow-2xl hover:shadow-slate-900/20 transition-all duration-500">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-white/10 rounded-xl">
                    <Zap className="h-5 w-5 text-blue-400" />
                  </div>
                  <ArrowRight className="h-5 w-5 text-white/40 group-hover:text-white transition-colors" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">Automated Sync</h3>
                  <p className="text-xs text-slate-400 font-medium leading-relaxed">Ensure structural alignment across all connected compute contexts.</p>
                </div>
                <Button variant="ghost" className="w-full mt-6 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold text-xs border border-white/5">
                  Start Discovery
                </Button>
              </div>
            </section>

            {/* Clusters Section */}
            <div className="space-y-10">
              <div className="flex items-center justify-between px-2">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900">Physical Fleet</h2>
                  <div className="h-0.5 w-10 bg-blue-600 mt-2 rounded-full" />
                </div>
                <Badge variant="outline" className="text-slate-500 border-slate-200 rounded-lg px-3 py-1 font-semibold text-[11px]">
                  {filteredClusters.length} Active Contexts
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                {filteredClusters.map((cluster) => (
                  <div
                    key={cluster.id}
                    className="relative group bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl hover:shadow-blue-600/5 hover:border-blue-200 transition-all duration-500 cursor-pointer overflow-hidden"
                    onClick={() => {
                      setCurrentClusterId(cluster.id);
                      setActiveCluster(backendClusterToCluster(cluster));
                      navigate('/home');
                    }}
                  >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/50 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-700" />

                    <div className="flex justify-between items-start mb-10">
                      <div className="relative">
                        <HealthRing score={currentClusterId === cluster.id ? (systemHealthScore ?? 0) : 0} size={64} strokeWidth={8} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className={cn("w-1.5 h-1.5 rounded-full", (currentClusterId === cluster.id ? (systemHealthScore ?? 0) : 0) > 80 ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-orange-500")} />
                        </div>
                      </div>
                      <Badge className="bg-slate-100 text-slate-500 border-none px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider relative">
                        {cluster.provider || 'Local'}
                      </Badge>
                    </div>

                    <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors tracking-tight">{cluster.name}</h3>
                    <p className="text-[10px] text-blue-600 font-bold mb-10 truncate tracking-wide bg-blue-50 px-2 py-0.5 rounded-md w-fit mt-1">
                      {cluster.server_url?.replace('https://', '').toUpperCase()}
                    </p>

                    <div className="grid grid-cols-2 gap-4 pb-6 border-b border-slate-100 mb-6">
                      <div className="space-y-0.5">
                        <div className="text-2xl font-bold text-slate-900 tabular-nums">{cluster.node_count ?? 0}</div>
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Nodes</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-2xl font-bold text-slate-900 tabular-nums">{cluster.namespace_count ?? 0}</div>
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Scopes</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Secure Access</span>
                      <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center group-hover:bg-blue-600 transition-all duration-300">
                        <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-white" />
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  className="bg-[#F9FBFC] border-2 border-dashed border-slate-200 rounded-[2.5rem] p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white hover:border-blue-300 hover:shadow-xl transition-all duration-500 group"
                  onClick={() => navigate('/setup/kubeconfig')}
                >
                  <div className="h-14 w-14 bg-white rounded-2xl border border-slate-200 flex items-center justify-center mb-5 group-hover:shadow-lg transition-all duration-500">
                    <Plus className="h-6 w-6 text-slate-400 group-hover:text-blue-600" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900">Add Infrastructure</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1.5">Connect New Cluster</p>
                </button>
              </div>
            </div>

            {/* Projects Section */}
            <div className="space-y-10">
              <div className="flex items-center justify-between px-2">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900">Governance Scopes</h2>
                  <div className="h-0.5 w-10 bg-blue-600 mt-2 rounded-full" />
                </div>
                <CreateProjectDialog>
                  <Button className="bg-slate-900 text-white rounded-xl h-11 px-6 font-bold text-xs uppercase tracking-wider shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition-all">
                    Initialize Project
                  </Button>
                </CreateProjectDialog>
              </div>

              {isProjectsLoading ? (
                <div className="flex items-center justify-center p-32 bg-white/40 rounded-[2.5rem] border border-slate-100 border-dashed">
                  <Loader2 className="h-10 w-10 text-blue-200 animate-spin" />
                </div>
              ) : projects.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-10">
                  {projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onClick={() => setSettingsProject(project)}
                    />
                  ))}
                </div>
              ) : (
                <div className="bg-white/40 backdrop-blur-md rounded-[2.5rem] border border-slate-100 border-dashed p-24 text-center">
                  <div className="h-20 w-20 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
                    <Focus className="h-8 w-8 text-blue-400" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">No logical scopes defined</h3>
                  <p className="text-slate-400 max-w-sm mx-auto mt-2 text-xs font-semibold uppercase tracking-wider leading-relaxed">
                    Aggregate clusters and namespaces into governed projects.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="intelligence" className="m-0 space-y-20">
            {/* Clean Hero Layout */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-12">
              <div className="lg:col-span-2 space-y-10">
                <div>
                  <Badge className="bg-blue-600/10 text-blue-700 border-none px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-6">
                    Autonomous Intelligence
                  </Badge>
                  <h2 className="text-6xl font-black tracking-tight text-slate-900 mb-8 leading-tight">
                    Intelligent <span className="text-blue-600">Governance.</span>
                  </h2>
                  <p className="text-xl text-slate-600 max-w-2xl leading-relaxed font-medium">
                    KOS-01 is actively monitoring {activeNodes} nodes across {activeClusters} connected environments. Operational efficiency is <span className="text-slate-900 font-bold underline decoration-blue-600 underline-offset-8">Optimal.</span>
                  </p>
                </div>

                <div className="flex flex-wrap gap-6 pt-4">
                  <div className="bg-white px-8 py-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-6 min-w-[220px] group hover:border-blue-200 transition-colors">
                    <div className="p-4 bg-emerald-50 rounded-2xl">
                      <ShieldCheck className="h-7 w-7 text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-slate-900 active-score">{systemHealthScore != null ? `${systemHealthScore}%` : '—'}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Health Status</div>
                    </div>
                  </div>
                  <div className="bg-white px-8 py-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-6 min-w-[220px] group hover:border-blue-200 transition-colors">
                    <div className="p-4 bg-blue-50 rounded-2xl">
                      <Activity className="h-7 w-7 text-blue-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-slate-900">{activeNodes}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Nodes</div>
                    </div>
                  </div>
                  <div className="bg-white px-8 py-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-6 min-w-[220px] group hover:border-purple-200 transition-colors">
                    <div className="p-4 bg-purple-50 rounded-2xl">
                      <Bot className="h-7 w-7 text-purple-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-slate-900 uppercase tracking-tight">{isAiEnabled ? 'Active' : 'Standby'}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Engine Status</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-xl shadow-slate-200/50 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-5 scale-125 transition-transform duration-700">
                  <Activity className="h-56 w-56 text-blue-600" />
                </div>
                <div className="relative z-10">
                  <h3 className="text-xl font-bold text-slate-900">System Inspector</h3>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mt-1">Real-time analysis</p>
                </div>
                <div className="py-12 flex justify-center relative z-10">
                  <HealthRing score={systemHealthScore ?? 0} size={140} strokeWidth={12} />
                </div>
                <Button className="w-full rounded-xl h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider shadow-xl shadow-blue-500/10 group relative z-10">
                  Detailed Audit
                  <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </section>

            {/* AI Insights */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-8">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-xl font-black text-slate-900 flex items-center gap-3 uppercase italic">
                    <div className="h-2 w-2 rounded-full bg-blue-400" />
                    Critical Observability
                  </h3>
                  <Badge variant="outline" className="rounded-full bg-slate-50 text-slate-500 border-slate-200 font-bold px-4 py-1">0 Faults</Badge>
                </div>
                <div className="bg-white rounded-[3.5rem] border border-slate-100 p-20 flex flex-col items-center justify-center text-center space-y-6 shadow-sm group hover:border-blue-200 transition-all duration-500">
                  <div className="h-24 w-24 bg-emerald-50 rounded-[2rem] flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                    <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                  </div>
                  <div>
                    <h4 className="text-2xl font-black text-slate-900 uppercase italic">Infrastructure Clear</h4>
                    <p className="text-slate-400 max-w-xs mx-auto font-bold uppercase tracking-widest text-[10px] mt-2">No resource contention detected</p>
                  </div>
                </div>
              </div>

              <div className="space-y-8">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-xl font-black text-slate-900 flex items-center gap-3 uppercase italic">
                    <div className="h-2 w-2 rounded-full bg-purple-400" />
                    Intelligence Feed
                  </h3>
                  <Badge variant="outline" className="rounded-full bg-purple-50 text-purple-600 border-purple-100 font-black uppercase text-[9px] px-4 py-1 tracking-widest">KOS-GPT-4</Badge>
                </div>
                <div className="bg-white rounded-[3.5rem] border border-slate-100 p-20 flex flex-col items-center justify-center text-center shadow-sm group hover:border-purple-200 transition-all duration-500">
                  {isAiEnabled ? (
                    <div className="space-y-6">
                      <div className="h-24 w-24 bg-purple-50 rounded-[2rem] flex items-center justify-center mx-auto group-hover:scale-110 transition-transform duration-500">
                        <Zap className="h-12 w-12 text-purple-500" />
                      </div>
                      <div>
                        <h4 className="text-2xl font-black text-slate-900 uppercase italic">Adaptive Learning</h4>
                        <p className="text-slate-400 max-w-xs mx-auto font-bold uppercase tracking-widest text-[10px] mt-2">Analyzing cluster behavior patterns...</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-10">
                      <div className="h-24 w-24 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto">
                        <Bot className="h-12 w-12 text-slate-300" />
                      </div>
                      <div>
                        <h4 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">Scale Intelligence</h4>
                        <p className="text-slate-400 max-w-xs mx-auto mt-3 font-bold uppercase tracking-widest text-[10px]">Context-aware autonomous optimization</p>
                      </div>
                      <Button onClick={() => setIsAiModalOpen(true)} className="bg-slate-900 hover:bg-slate-800 text-white rounded-2xl h-14 px-10 font-black uppercase italic tracking-widest text-xs shadow-2xl shadow-slate-900/40">
                        Activate AI Hub
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <AISetupModal open={isAiModalOpen} onOpenChange={setIsAiModalOpen} />
      {settingsProject && (
        <ProjectSettingsDialog
          project={settingsProject}
          open={!!settingsProject}
          onOpenChange={(open) => !open && setSettingsProject(null)}
        />
      )}
    </div>
  );
}
