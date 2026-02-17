import React from "react";
import { Link } from "react-router-dom";
import { Sparkles, ArrowRight, Zap, TrendingUp, Cpu, Shield, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const insights = [
    {
        type: "prediction",
        title: "Resource Spike Predicted",
        description: "Traffic likely to increase by 40% in 2 hours based on historical patterns.",
        action: "Scale Up",
        icon: TrendingUp,
        color: "text-violet-600 dark:text-violet-400",
        bg: "bg-violet-500/10",
        metric: { value: 40, label: "+40%", showBar: true },
    },
    {
        type: "optimization",
        title: "Cost Saving Opportunity",
        description: "3 nodes underutilized. Consolidating could save $120/mo.",
        action: "Optimize",
        icon: Zap,
        color: "text-amber-600 dark:text-amber-400",
        bg: "bg-amber-500/10",
        metric: { value: 120, label: "$120/mo", showBar: false },
    },
    {
        type: "alert",
        title: "High Memory Pod",
        description: "nginx-deployment-abc123 at 92% memory. Consider increasing limits.",
        action: "View Pod",
        icon: Cpu,
        color: "text-rose-600 dark:text-rose-400",
        bg: "bg-rose-500/10",
        metric: { value: 92, label: "92%", showBar: true },
    },
    {
        type: "security",
        title: "Image Update Available",
        description: "5 workloads use base images with known CVEs.",
        action: "Review",
        icon: Shield,
        color: "text-blue-600 dark:text-blue-400",
        bg: "bg-blue-500/10",
        metric: { value: 5, label: "5 CVEs", showBar: false },
    },
    {
        type: "warning",
        title: "API Server Latency",
        description: "P99 Latency approaching SLA limits (450ms). Control plane load high.",
        action: "Check Control Plane",
        icon: Activity,
        color: "text-amber-600 dark:text-amber-400",
        bg: "bg-amber-500/10",
        metric: { value: 85, label: "450ms", showBar: true },
    },
];

export const AIInsightsPanel = () => {
    return (
        <Card className="h-full min-h-[320px] border-none glass-panel relative overflow-hidden flex flex-col">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500/80 to-primary/80" />
            <CardHeader className="pb-4 pt-5 px-6">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2.5 text-base font-semibold text-foreground">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                            <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
                        </div>
                        <span>AI Insights</span>
                    </CardTitle>
                    <span className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        LIVE
                    </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 font-normal">Predictive and actionable recommendations</p>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto px-6 pb-6 pt-0">
                <div className="space-y-3">
                    {insights.map((item, idx) => {
                        const href = item.type === "alert" ? "/pods" : item.type === "security" ? "/deployments" : item.type === "optimization" ? "/nodes" : "/deployments";
                        return (
                            <Link
                                key={idx}
                                to={href}
                                className="group block rounded-xl border border-border/40 bg-muted/30 p-4 transition-all hover:border-primary/20 hover:bg-muted/50"
                            >
                                <div className="flex gap-3">
                                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.bg} ${item.color}`}>
                                        <item.icon className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h4 className="text-sm font-semibold text-foreground leading-tight">{item.title}</h4>
                                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                                            {item.description}
                                        </p>
                                        {item.metric.showBar ? (
                                            <div className="mt-2 flex items-center gap-2">
                                                <Progress
                                                    value={item.metric.value}
                                                    className="h-1.5 flex-1"
                                                    indicatorClassName={item.type === "alert" ? "bg-rose-500" : "bg-violet-500"}
                                                />
                                                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{item.metric.label}</span>
                                            </div>
                                        ) : (
                                            <span className="mt-1.5 inline-block rounded-md bg-muted/80 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                                                {item.metric.label}
                                            </span>
                                        )}
                                        <span className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:text-primary/80 transition-colors">
                                            {item.action}
                                            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
};
