import type { TopologyNode } from "../types/topology";
import { healthColors, healthStatusMap } from "../nodes/nodeConfig";

/**
 * Computes health overlay styles for a node.
 * Returns CSS properties for left border and background tint.
 */
export function getHealthOverlayStyles(
  node: TopologyNode,
  enabled: boolean
): React.CSSProperties {
  if (!enabled) return {};

  const healthKey = healthStatusMap[node.status] ?? "unknown";
  const color = healthColors[healthKey];

  return {
    borderLeftWidth: 4,
    borderLeftColor: color,
    borderLeftStyle: "solid",
  };
}

/**
 * Computes aggregate health for a group of nodes.
 */
export function computeGroupHealth(
  nodes: TopologyNode[]
): "healthy" | "warning" | "error" | "unknown" {
  if (nodes.length === 0) return "unknown";

  let hasError = false;
  let hasWarning = false;
  let healthyCount = 0;

  for (const node of nodes) {
    const h = healthStatusMap[node.status] ?? "unknown";
    if (h === "error") hasError = true;
    else if (h === "warning") hasWarning = true;
    else if (h === "healthy") healthyCount++;
  }

  if (hasError) return "error";
  if (hasWarning) return "warning";
  if (healthyCount > nodes.length * 0.9) return "healthy";
  return "warning";
}

/**
 * HealthLegend: Displays health color legend for the topology.
 */
export function HealthLegend({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="absolute bottom-16 left-3 z-10 rounded-lg border border-gray-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur-sm">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Health Status</div>
      <div className="space-y-1.5">
        <LegendItem color={healthColors.healthy} label="Healthy" />
        <LegendItem color={healthColors.warning} label="Warning" />
        <LegendItem color={healthColors.error} label="Error" />
        <LegendItem color={healthColors.unknown} label="Unknown" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-3 w-3 rounded-full ring-2 ring-offset-1"
        style={{ backgroundColor: color, boxShadow: `0 0 0 2px white, 0 0 0 3px ${color}30` }}
      />
      <span className="text-gray-700 font-medium">{label}</span>
    </div>
  );
}
