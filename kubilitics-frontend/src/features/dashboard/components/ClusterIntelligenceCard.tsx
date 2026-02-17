import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Brain,
    Zap,
    AlertTriangle,
    Shield,
    TrendingUp,
    ChevronRight,
    Loader2,
    Sparkles,
    ArrowRight
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, XAxis } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

// --- Types ---

type InsightType = 'critical' | 'warning' | 'optimization' | 'prediction' | 'security';

interface Insight {
    id: string;
    type: InsightType;
    title: string;
    description: string;
    timestamp: Date;
    action: string;
    link: string;
    impact?: string; // e.g., "Potential Downtime", "$45/mo savings"
}

// --- Mock Hook (Simulating the "Sidecar Brain") ---

const useAIInsights = () => {
    const [insights, setInsights] = useState<Insight[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Simulate initial load delay
        const timer = setTimeout(() => {
            setInsights([
                {
                    id: '1',
                    type: 'prediction',
                    title: 'OOM Predicted: payment-service',
                    description: 'Memory usage trending up +15%/hr. Predicted OOM in ~40 mins.',
                    timestamp: new Date(),
                    action: 'View Analysis',
                    link: '/pods',
                    impact: 'Service Outage Risk'
                },
                {
                    id: '2',
                    type: 'optimization',
                    title: 'Idle Resources in Dev',
                    description: '3 expensive GPU nodes in `dev-cluster` are 95% idle for >12h.',
                    timestamp: new Date(),
                    action: 'Scale Down',
                    link: '/nodes',
                    impact: 'Save ~$120/day'
                },
                {
                    id: '3',
                    type: 'security',
                    title: 'Privileged Pod Detected',
                    description: 'New deployment `unknown-miner` requesting privileged access.',
                    timestamp: new Date(),
                    action: 'Review',
                    link: '/deployments',
                    impact: 'High Security Risk'
                },
                {
                    id: '4',
                    type: 'warning',
                    title: 'Network Saturation',
                    description: 'Ingress bandwidth at 85% capacity. Analyze traffic source.',
                    timestamp: new Date(),
                    action: 'View Traffic',
                    link: '/network',
                    impact: 'Latency at Risk'
                }
            ]);
            setIsLoading(false);
        }, 1500);

        return () => clearTimeout(timer);
    }, []);

    return { insights, isLoading };
};

// --- Helper Functions ---

const getInsightConfig = (type: InsightType) => {
    switch (type) {
        case 'critical':
        case 'security':
            return {
                icon: Shield, // or AlertTriangle
                bg: 'bg-rose-500/10',
                border: 'border-rose-500/20',
                text: 'text-rose-500',
                glow: 'shadow-[0_0_15px_rgba(244,63,94,0.1)]'
            };
        case 'prediction':
            return {
                icon: Brain,
                bg: 'bg-violet-500/10',
                border: 'border-violet-500/20',
                text: 'text-violet-500',
                glow: 'shadow-[0_0_15px_rgba(139,92,246,0.1)]'
            };
        case 'optimization':
            return {
                icon: Zap,
                bg: 'bg-emerald-500/10',
                border: 'border-emerald-500/20',
                text: 'text-emerald-500', // Making money/green
                glow: 'shadow-[0_0_15px_rgba(16,185,129,0.1)]'
            };
        case 'warning':
        default:
            return {
                icon: AlertTriangle,
                bg: 'bg-amber-500/10',
                border: 'border-amber-500/20',
                text: 'text-amber-500',
                glow: 'shadow-[0_0_15px_rgba(245,158,11,0.1)]'
            };
    }
};

// --- Chart Components ---

const PredictionChart = () => {
    const data = [
        { time: '10:00', value: 45 },
        { time: '10:10', value: 52 },
        { time: '10:20', value: 58 },
        { time: '10:30', value: 65 },
        { time: '10:40', value: 85 }, // OOM danger zone
        { time: '10:50', value: 95 },
    ];
    return (
        <div className="h-16 w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="predictionGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="value" stroke="#8b5cf6" fill="url(#predictionGradient)" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

const SavingsChart = () => {
    const data = [
        { name: 'Current', value: 180 },
        { name: 'Optimized', value: 60 },
    ];
    return (
        <div className="h-16 w-32 mt-2">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical">
                    <XAxis type="number" hide />
                    <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} barSize={8} background={{ fill: 'rgba(0,0,0,0.05)' }} isAnimationActive={false} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

const NetworkChart = () => {
    const data = [
        { time: '1', value: 20 },
        { time: '2', value: 40 },
        { time: '3', value: 30 },
        { time: '4', value: 70 },
        { time: '5', value: 85 },
        { time: '6', value: 60 },
    ];
    return (
        <div className="h-16 w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="networkGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="value" stroke="#f59e0b" fill="url(#networkGradient)" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

// --- Component ---

export function ClusterIntelligenceCard() {
    const { insights, isLoading } = useAIInsights();

    return (
        <Card className="h-full min-h-[320px] border-none glass-panel relative overflow-hidden flex flex-col group" aria-label="Cluster Intelligence">
            {/* Premium Gradient Top Border */}
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-violet-600 via-fuchsia-500 to-indigo-600 opacity-80" />

            {/* Ambient Background Glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

            <CardHeader className="pb-4 pt-5 px-6 shrink-0 relative z-10">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-3 text-lg font-bold tracking-tight text-foreground">
                        <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 ring-1 ring-violet-500/20">
                            <Brain className="h-4 w-4 text-violet-500" />
                            {/* Pulse Animation */}
                            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500"></span>
                            </span>
                        </div>
                        <span>Cluster Intelligence</span>
                    </CardTitle>

                    {/* Status Badge */}
                    <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/5 border border-violet-500/10">
                        <div className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                        <span className="text-[10px] font-medium text-violet-500/80 uppercase tracking-wider">
                            {isLoading ? 'ANALYZING' : 'LIVE'}
                        </span>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 font-medium">
                    Proactive analysis & predictive insights
                </p>
            </CardHeader>

            <CardContent className="flex-1 px-6 pb-6 pt-0 overflow-y-auto relative z-10 no-scrollbar">
                {isLoading ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4 py-8">
                        <div className="relative">
                            <div className="h-12 w-12 rounded-full border-2 border-violet-500/20 border-t-violet-500 animate-spin" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Brain className="h-4 w-4 text-violet-500/50" />
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground animate-pulse">Analyzing cluster telemetry...</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <AnimatePresence>
                            {insights.map((insight, index) => {
                                const config = getInsightConfig(insight.type);
                                const Icon = config.icon;

                                return (
                                    <motion.div
                                        key={insight.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.1, duration: 0.4 }}
                                        className="group/item"
                                    >
                                        <Link
                                            to={insight.link}
                                            className={`block relative overflow-visible rounded-xl border border-border/40 bg-muted/20 p-4 transition-all duration-300 hover:bg-muted/40 hover:border-violet-500/30 hover:shadow-lg hover:-translate-y-0.5 ${config.glow}`}
                                        >
                                            {/* Left colored accent bar */}
                                            <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${config.bg.replace('/10', '/60')}`} />

                                            <div className="flex gap-4 pl-2">
                                                {/* Icon Box */}
                                                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${config.bg} ring-1 ring-inset ${config.border}`}>
                                                    <Icon className={`h-5 w-5 ${config.text}`} />
                                                </div>

                                                {/* Content */}
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <h4 className="text-sm font-semibold text-foreground leading-tight group-hover/item:text-violet-400 transition-colors">
                                                            {insight.title}
                                                        </h4>
                                                        {insight.impact && (
                                                            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md ${config.bg} ${config.text}`}>
                                                                {insight.impact}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                                                        {insight.description}
                                                    </p>

                                                    {/* Embedded Charts */}
                                                    {insight.type === 'prediction' && <PredictionChart />}
                                                    {insight.type === 'optimization' && (
                                                        <div className="flex items-center justify-between">
                                                            <SavingsChart />
                                                            <div className="text-right">
                                                                <span className="block text-xl font-bold text-emerald-500">-$120</span>
                                                                <span className="text-[10px] text-muted-foreground">Monthly Savings</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {insight.title === 'Network Saturation' && <NetworkChart />}

                                                    {/* Footer / Action */}
                                                    <div className="mt-3 flex items-center gap-2">
                                                        <span className="text-xs font-medium text-primary flex items-center gap-1 group-hover/item:underline underline-offset-4 decoration-primary/30">
                                                            {insight.action}
                                                            <ArrowRight className="h-3 w-3 transition-transform group-hover/item:translate-x-1" />
                                                        </span>
                                                        <span className="text-[10px] text-muted-foreground/60 ml-auto">
                                                            Just now
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>

                        {/* Empty State Fallback (if no insights) */}
                        {insights.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3">
                                    <Sparkles className="h-6 w-6 text-violet-500" />
                                </div>
                                <p className="text-sm font-medium text-foreground">Cluster is optimized</p>
                                <p className="text-xs text-muted-foreground max-w-[200px] mt-1">
                                    AI brain has not detected any anomalies or optimization opportunities.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
