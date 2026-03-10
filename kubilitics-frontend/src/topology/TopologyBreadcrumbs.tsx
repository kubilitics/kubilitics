import { ChevronRight, Globe, Layers, Box, Target, Shield } from "lucide-react";
import type { ViewMode } from "./types/topology";

export interface TopologyBreadcrumbsProps {
  viewMode: ViewMode;
  namespace?: string | null;
  resource?: string | null;
}

const viewModeIcons: Record<ViewMode, React.ReactNode> = {
  cluster: <Globe className="h-3 w-3" />,
  namespace: <Layers className="h-3 w-3" />,
  workload: <Box className="h-3 w-3" />,
  resource: <Target className="h-3 w-3" />,
  rbac: <Shield className="h-3 w-3" />,
};

export function TopologyBreadcrumbs({
  viewMode,
  namespace,
  resource,
}: TopologyBreadcrumbsProps) {
  const parts: { label: string; icon?: React.ReactNode; active?: boolean }[] = [
    { label: "cluster", icon: <Globe className="h-3 w-3" /> },
  ];

  if (viewMode !== "cluster") {
    parts.push({ label: namespace ?? "all namespaces", icon: <Layers className="h-3 w-3" /> });
  }
  if (viewMode === "workload" || viewMode === "resource") {
    parts.push({ label: "workloads", icon: <Box className="h-3 w-3" /> });
  }
  if (viewMode === "resource" && resource) {
    parts.push({ label: resource, icon: <Target className="h-3 w-3" /> });
  }
  if (viewMode === "rbac") {
    parts.push({ label: "RBAC", icon: <Shield className="h-3 w-3" /> });
  }

  // Mark last item as active
  if (parts.length > 0) parts[parts.length - 1].active = true;

  return (
    <div className="flex items-center gap-1 border-b border-gray-100 bg-gray-50/80 px-4 py-2 text-xs">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-gray-300 mx-0.5" />}
          <span className={`flex items-center gap-1 ${
            p.active
              ? "font-semibold text-gray-900 bg-white px-2 py-0.5 rounded-md border border-gray-200 shadow-sm"
              : "text-gray-500"
          }`}>
            {p.icon}
            {p.label}
          </span>
        </span>
      ))}
    </div>
  );
}
