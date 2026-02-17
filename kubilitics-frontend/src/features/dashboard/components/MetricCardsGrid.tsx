import React from "react";
import { Link } from "react-router-dom";
import {
    Server,
    Activity,
    Layers,
    Globe,
    FolderKanban,
    Shield,
    FileText,
    KeyRound,
    Timer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useResourceCounts } from "@/hooks/useResourceCounts";

export const MetricCardsGrid = () => {
    const { counts } = useResourceCounts();

    const cardConfigs: Array<{
        title: string;
        value: number;
        href: string;
        icon: typeof Server;
        borderClass: string;
        bgClass: string;
        iconBg: string;
        iconColor: string;
    }> = [
            // — Infrastructure —
            {
                title: "Nodes",
                value: counts.nodes,
                href: "/nodes",
                icon: Server,
                borderClass: "border-l-blue-500",
                bgClass: "bg-gradient-to-br from-blue-500/8 via-transparent to-transparent",
                iconBg: "bg-blue-500/15",
                iconColor: "text-blue-600",
            },
            {
                title: "Pods",
                value: counts.pods,
                href: "/pods",
                icon: Activity,
                borderClass: "border-l-violet-500",
                bgClass: "bg-gradient-to-br from-violet-500/8 via-transparent to-transparent",
                iconBg: "bg-violet-500/15",
                iconColor: "text-violet-600",
            },
            {
                title: "Deployments",
                value: counts.deployments,
                href: "/deployments",
                icon: Layers,
                borderClass: "border-l-indigo-500",
                bgClass: "bg-gradient-to-br from-indigo-500/8 via-transparent to-transparent",
                iconBg: "bg-indigo-500/15",
                iconColor: "text-indigo-600",
            },
            // — Networking & Organization —
            {
                title: "Services",
                value: counts.services,
                href: "/services",
                icon: Globe,
                borderClass: "border-l-cyan-500",
                bgClass: "bg-gradient-to-br from-cyan-500/8 via-transparent to-transparent",
                iconBg: "bg-cyan-500/15",
                iconColor: "text-cyan-600",
            },
            {
                title: "DaemonSets",
                value: counts.daemonsets,
                href: "/daemonsets",
                icon: Shield,
                borderClass: "border-l-rose-500",
                bgClass: "bg-gradient-to-br from-rose-500/8 via-transparent to-transparent",
                iconBg: "bg-rose-500/15",
                iconColor: "text-rose-600",
            },
            {
                title: "Namespaces",
                value: counts.namespaces,
                href: "/namespaces",
                icon: FolderKanban,
                borderClass: "border-l-emerald-500",
                bgClass: "bg-gradient-to-br from-emerald-500/8 via-transparent to-transparent",
                iconBg: "bg-emerald-500/15",
                iconColor: "text-emerald-600",
            },
            // — Configuration & Security —
            {
                title: "ConfigMaps",
                value: counts.configmaps,
                href: "/configmaps",
                icon: FileText,
                borderClass: "border-l-amber-500",
                bgClass: "bg-gradient-to-br from-amber-500/8 via-transparent to-transparent",
                iconBg: "bg-amber-500/15",
                iconColor: "text-amber-600",
            },
            {
                title: "Secrets",
                value: counts.secrets,
                href: "/secrets",
                icon: KeyRound,
                borderClass: "border-l-fuchsia-500",
                bgClass: "bg-gradient-to-br from-fuchsia-500/8 via-transparent to-transparent",
                iconBg: "bg-fuchsia-500/15",
                iconColor: "text-fuchsia-600",
            },
            {
                title: "CronJobs",
                value: counts.cronjobs,
                href: "/cronjobs",
                icon: Timer,
                borderClass: "border-l-orange-500",
                bgClass: "bg-gradient-to-br from-orange-500/8 via-transparent to-transparent",
                iconBg: "bg-orange-500/15",
                iconColor: "text-orange-600",
            },
        ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-fr h-full">
            {cardConfigs.map((metric) => (
                <Link key={metric.title} to={metric.href} className="block h-full group hover:no-underline">
                    <Card
                        className={`overflow-hidden relative h-full hover:shadow-lg transition-all duration-300 border border-border/60 border-l-4 ${metric.borderClass} shadow-sm hover:border-l-[6px]`}
                    >
                        {/* Colored background wash */}
                        <div
                            className={`absolute inset-0 pointer-events-none ${metric.bgClass}`}
                            aria-hidden
                        />
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5 px-5 z-10 relative">
                            <CardTitle className="text-sm font-bold text-foreground tracking-tight">
                                {metric.title}
                            </CardTitle>
                            <div
                                className={`p-2 rounded-xl ${metric.iconBg} ${metric.iconColor} shadow-sm transition-transform group-hover:scale-110 duration-300`}
                            >
                                <metric.icon className="h-4.5 w-4.5" />
                            </div>
                        </CardHeader>
                        <CardContent className="z-10 relative px-5 pb-5">
                            <div className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                                {metric.value}
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                Live count from cluster
                            </p>
                        </CardContent>
                    </Card>
                </Link>
            ))}
        </div>
    );
};
