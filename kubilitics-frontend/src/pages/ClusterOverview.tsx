import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Server,
    Search,
    RefreshCw,
    ArrowUpRight,
    Activity,
    Layers
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useClusterOverviewData } from '@/hooks/useClusterOverviewData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { InfrastructureMap } from '@/components/cluster/InfrastructureMap';

export default function ClusterOverview() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data, isLoading } = useClusterOverviewData();

    const handleSync = useCallback(() => {
        setIsSyncing(true);
        queryClient.invalidateQueries({ queryKey: ['k8s'] });
        setTimeout(() => setIsSyncing(false), 1500);
    }, [queryClient]);

    const filteredResources = data?.resources.filter(r =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.kind.toLowerCase().includes(searchQuery.toLowerCase())
    ) ?? [];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <RefreshCw className="h-8 w-8 animate-spin text-[#326CE5]" />
            </div>
        );
    }

    const nodes = data?.resources.filter(r => r.kind === 'Node').map(n => ({
        name: n.name,
        status: n.status as 'Ready' | 'NotReady'
    })) ?? [];

    const namespaceCount = data?.resources.filter(r => r.kind === 'Namespace').length ?? 0;

    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Header Section */}
            <SectionOverviewHeader
                title="Cluster Overview"
                description="High-fidelity visibility across physical infrastructure, system namespaces, and control plane health."
                icon={Server}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Hero Section: Infrastructure Map & Health Pulse */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Node Topography */}
                <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm">
                    <CardHeader className="pb-0">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-xl font-black text-[#326CE5]">Compute Topography</CardTitle>
                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Physical & Virtualized Node Matrix</p>
                            </div>
                            <Badge className="bg-[#326CE5]/10 text-[#326CE5] border-transparent font-bold">
                                {nodes.length} Nodes Online
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-4 pb-8">
                        <InfrastructureMap nodes={nodes} />

                        <div className="grid grid-cols-3 gap-6 mt-8 border-t border-slate-100 pt-8">
                            <div className="">
                                <span className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">System Load</span>
                                <div className="flex items-end gap-2">
                                    <span className="text-2xl font-black text-[#326CE5]">Nominal</span>
                                    <span className="text-[10px] font-bold text-emerald-500 mb-1">STABLE</span>
                                </div>
                            </div>
                            <div className="">
                                <span className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Control Plane</span>
                                <div className="flex items-end gap-2">
                                    <span className="text-2xl font-black text-[#326CE5]">v1.28.3</span>
                                    <span className="text-[10px] font-bold text-[#326CE5]/60 mb-1">AZURE-EKS</span>
                                </div>
                            </div>
                            <div className="">
                                <span className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Zones</span>
                                <div className="flex items-end gap-2">
                                    <span className="text-2xl font-black text-[#326CE5]">Multi-AZ</span>
                                    <span className="text-[10px] font-bold text-[#326CE5]/60 mb-1">3 ACTIVE</span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Health Metric & Quick Stats */}
                <Card className="lg:col-span-4 border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm flex flex-col p-8 relative overflow-hidden group">
                    {/* Subtle Background Watermark */}
                    <Activity className="absolute -bottom-10 -right-10 w-48 h-48 opacity-[0.02] text-[#326CE5] rotate-12" />

                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <div className="h-32 w-32 rounded-full border-8 border-[#326CE5]/5 flex items-center justify-center relative">
                            <motion.div
                                initial={{ rotate: 0 }}
                                animate={{ rotate: 360 }}
                                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                                className="absolute inset-0 rounded-full border-t-8 border-[#326CE5]"
                            />
                            <div>
                                <span className="block text-3xl font-black text-[#326CE5]">{data?.pulse.optimal_percent.toFixed(0)}%</span>
                                <span className="text-[10px] font-bold text-muted-foreground uppercase">Stability</span>
                            </div>
                        </div>
                        <h4 className="mt-6 text-sm font-black text-[#326CE5] uppercase tracking-widest">Global Pulse Health</h4>
                        <p className="text-[11px] text-muted-foreground mt-2 font-medium">99.9% SLO maintained across all compute clusters</p>
                    </div>

                    <div className="mt-8 pt-8 border-t border-slate-100 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10">
                                <span className="block text-xl font-black text-[#326CE5]">{namespaceCount}</span>
                                <span className="text-[9px] font-bold uppercase text-muted-foreground">Namespaces</span>
                            </div>
                            <div className="p-3 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10">
                                <span className="block text-xl font-black text-[#326CE5]">{nodes.length}</span>
                                <span className="text-[9px] font-bold uppercase text-muted-foreground">Compute Nodes</span>
                            </div>
                        </div>
                        <Button className="w-full h-12 bg-[#326CE5] hover:bg-[#2856b3] rounded-xl font-bold shadow-lg shadow-[#326CE5]/10">
                            Cluster Maintenance
                        </Button>
                    </div>
                </Card>
            </div>

            {/* Explorer Table */}
            <div className="bg-card border border-primary/5 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-6 border-b border-primary/5 flex flex-col md:flex-row md:items-center gap-4 justify-between bg-muted/20">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search infrastructure resources..."
                            className="pl-10 bg-background/50 border-primary/10 transition-all rounded-xl focus:ring-[#326CE5]/20"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-muted/30">
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Resource Name</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Kind</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Status</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Version / Details</th>
                                <th className="px-6 py-4 border-b border-primary/5"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-primary/5">
                            {filteredResources.map((resource, idx) => (
                                <motion.tr
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    key={`${resource.kind}-${resource.name}`}
                                    className="group hover:bg-[#326CE5]/5 transition-colors"
                                >
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-foreground group-hover:text-[#326CE5] transition-colors">
                                            {resource.name}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge variant="outline" className="font-bold text-[9px] uppercase tracking-wider bg-white border-[#326CE5]/20 text-[#326CE5]">
                                            {resource.kind}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className={cn("h-1.5 w-1.5 rounded-full", ['Ready', 'Active'].includes(resource.status) ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500")} />
                                            <span className="text-[12px] font-bold text-slate-700">{resource.status}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-[12px] font-black text-[#326CE5]">
                                            {resource.version || '-'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-[#326CE5] hover:text-white rounded-lg transition-all">
                                            <ArrowUpRight className="h-4 w-4" />
                                        </Button>
                                    </td>
                                </motion.tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
