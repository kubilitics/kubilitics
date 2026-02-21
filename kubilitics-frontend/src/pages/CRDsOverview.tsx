import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    FileCode,
    Search,
    RefreshCw,
    ArrowUpRight,
    Braces,
    Shield
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useCRDOverview } from '@/hooks/useCRDOverview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';

export default function CRDsOverview() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data, isLoading } = useCRDOverview();

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

    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Header Section */}
            <SectionOverviewHeader
                title="Custom Resources"
                description="High-fidelity visibility across the cluster's custom API registry and expanded resource definitions."
                icon={FileCode}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Hero Section: Registry Standing */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm relative">
                    {/* Visual pattern */}
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        <Braces className="w-32 h-32 text-[#326CE5]" />
                    </div>

                    <CardHeader>
                        <div>
                            <CardTitle className="text-xl font-black text-[#326CE5]">API Registry Standing</CardTitle>
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Global Custom Resource Definitions</p>
                        </div>
                    </CardHeader>
                    <CardContent className="pb-8">
                        <div className="flex items-end gap-8 mt-4">
                            <div>
                                <span className="block text-5xl font-black text-[#326CE5]">{data?.resources.length}</span>
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Active Definitions</span>
                            </div>
                            <div className="h-12 w-[1px] bg-slate-100" />
                            <div>
                                <span className="block text-2xl font-black text-[#326CE5]">Standard</span>
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Compliance Level</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                            <div className="p-4 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                    <span className="text-xs font-bold text-slate-700">Schema Validation</span>
                                </div>
                                <span className="text-[10px] font-black text-[#326CE5] uppercase">Verified</span>
                            </div>
                            <div className="p-4 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-[#326CE5]" />
                                    <span className="text-xs font-bold text-slate-700">API Priority</span>
                                    <span className="text-[10px] font-black text-[#326CE5] uppercase">Normal</span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="lg:col-span-4 border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm flex flex-col p-8 relative overflow-hidden group">
                    <Shield className="absolute -bottom-10 -right-10 w-48 h-48 opacity-[0.02] text-[#326CE5] rotate-12" />

                    <div className="flex-1">
                        <h3 className="text-lg font-black text-[#326CE5]">Schema Intelligence</h3>
                        <p className="text-xs text-muted-foreground mt-2 font-medium">Monitoring custom API group health and schema consistency across namespaces.</p>

                        <div className="mt-8 space-y-4">
                            <div className="flex items-center justify-between text-xs font-bold">
                                <span className="text-muted-foreground uppercase tracking-tighter">Registry Sync</span>
                                <span className="text-emerald-500 uppercase tracking-tighter">In Sync</span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: '100%' }}
                                    className="h-full bg-emerald-500 rounded-full"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mt-8">
                        <Button className="w-full h-12 bg-[#326CE5] hover:bg-[#2856b3] rounded-xl font-bold shadow-lg shadow-[#326CE5]/10">
                            Register Definition
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
                            placeholder="Search custom definitions..."
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
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Group / API</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Status</th>
                                <th className="px-6 py-4 border-b border-primary/5"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-primary/5">
                            {filteredResources.map((resource, idx) => (
                                <motion.tr
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    key={`${resource.name}`}
                                    className="group hover:bg-[#326CE5]/5 transition-colors"
                                >
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-foreground group-hover:text-[#326CE5] transition-colors">
                                            {resource.name}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge variant="outline" className="font-bold text-[9px] uppercase tracking-wider bg-white border-[#326CE5]/20 text-[#326CE5]">
                                            {resource.group}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                            <span className="text-[12px] font-bold text-slate-700">Established</span>
                                        </div>
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
