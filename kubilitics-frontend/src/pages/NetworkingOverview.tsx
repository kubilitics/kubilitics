import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Globe,
    Search,
    Filter,
    RefreshCw,
    ArrowUpRight,
    Shield,
    Network
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNetworkingOverview } from '@/hooks/useNetworkingOverview';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';

export default function NetworkingOverview() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data, isLoading } = useNetworkingOverview();

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
                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-8 max-w-[1600px] mx-auto pb-20">
            {/* Header Section */}
            <SectionOverviewHeader
                title="Networking Overview"
                description="Manage services, ingresses, and security policies."
                icon={Globe}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-card/50 backdrop-blur-sm border-primary/10">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-muted-foreground">Pulse Health</span>
                            <ActivityIcon className="h-4 w-4 text-emerald-500" />
                        </div>
                        <div className="text-3xl font-bold text-emerald-500">
                            {data?.pulse.optimal_percent.toFixed(1)}%
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur-sm border-primary/10">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-muted-foreground">Total Services</span>
                            <Globe className="h-4 w-4 text-primary" />
                        </div>
                        <div className="text-3xl font-bold">
                            {data?.resources.filter(r => r.kind === 'Service').length}
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur-sm border-primary/10">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-muted-foreground">Active Ingresses</span>
                            <Network className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="text-3xl font-bold">
                            {data?.resources.filter(r => r.kind === 'Ingress').length}
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur-sm border-primary/10">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-muted-foreground">Network Policies</span>
                            <Shield className="h-4 w-4 text-amber-500" />
                        </div>
                        <div className="text-3xl font-bold">
                            {data?.resources.filter(r => r.kind === 'NetworkPolicy').length}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Explorer Table */}
            <div className="bg-card border border-primary/5 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-6 border-b border-primary/5 flex flex-col md:flex-row md:items-center gap-4 justify-between bg-muted/20">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Filter by name or kind..."
                            className="pl-10 bg-background/50 border-primary/10 focus:ring-primary/20 transition-all rounded-xl"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="rounded-lg h-9 border-primary/10 hover:bg-muted/50">
                            <Filter className="h-3.5 w-3.5 mr-2" />
                            Advanced Filters
                        </Button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-muted/30">
                                <th className="px-6 py-4 text-sm font-semibold text-muted-foreground border-b border-primary/5">Name</th>
                                <th className="px-6 py-4 text-sm font-semibold text-muted-foreground border-b border-primary/5">Kind</th>
                                <th className="px-6 py-4 text-sm font-semibold text-muted-foreground border-b border-primary/5">Namespace</th>
                                <th className="px-6 py-4 text-sm font-semibold text-muted-foreground border-b border-primary/5">Status</th>
                                <th className="px-6 py-4 text-sm font-semibold text-muted-foreground border-b border-primary/5">Type</th>
                                <th className="px-6 py-4 text-sm font-semibold text-muted-foreground border-b border-primary/5"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-primary/5">
                            {filteredResources.map((resource, idx) => (
                                <motion.tr
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    key={`${resource.kind}-${resource.name}`}
                                    className="group hover:bg-muted/30 transition-colors"
                                >
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-foreground group-hover:text-primary transition-colors">
                                            {resource.name}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider bg-background/50 border-primary/10">
                                            {resource.kind}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-muted-foreground">
                                        {resource.namespace}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className={cn("h-2 w-2 rounded-full", resource.status === 'Active' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500")} />
                                            <span className="text-sm font-medium">{resource.status}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-sm text-muted-foreground italic font-light">
                                            {resource.type || '-'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary rounded-lg transition-all">
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

function ActivityIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
    );
}
