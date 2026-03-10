import type { ViewMode } from "../types/topology";
import {
  Globe, Layers, Box, Target, Shield,
} from "lucide-react";

export interface ViewModeSelectProps {
  value?: ViewMode;
  onChange?: (mode: ViewMode) => void;
}

const modes: { value: ViewMode; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { value: "cluster", label: "Cluster", icon: <Globe className="h-3.5 w-3.5" />, shortcut: "1" },
  { value: "namespace", label: "Namespace", icon: <Layers className="h-3.5 w-3.5" />, shortcut: "2" },
  { value: "workload", label: "Workload", icon: <Box className="h-3.5 w-3.5" />, shortcut: "3" },
  { value: "resource", label: "Resource", icon: <Target className="h-3.5 w-3.5" />, shortcut: "4" },
  { value: "rbac", label: "RBAC", icon: <Shield className="h-3.5 w-3.5" />, shortcut: "5" },
];

export function ViewModeSelect({ value = "namespace", onChange }: ViewModeSelectProps) {
  return (
    <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      {modes.map((m) => {
        const isActive = m.value === value;
        return (
          <button
            key={m.value}
            type="button"
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-700 hover:bg-white/50 border border-transparent"
            }`}
            onClick={() => onChange?.(m.value)}
            title={`${m.label} view (${m.shortcut})`}
          >
            {m.icon}
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
