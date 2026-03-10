import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { BaseNodeData } from "./BaseNode";

/** Category-based fill colors for minimal dots */
const categoryFill: Record<string, string> = {
  compute: "#3b82f6",
  networking: "#8b5cf6",
  config: "#f59e0b",
  storage: "#06b6d4",
  security: "#ec4899",
  scheduling: "#6b7280",
  scaling: "#22c55e",
  custom: "#94a3b8",
};

/** Status-based ring colors */
const statusRing: Record<string, string> = {
  healthy: "#10b981",
  warning: "#f59e0b",
  error: "#ef4444",
  unknown: "#9ca3af",
};

/**
 * MinimalNode: Displayed at extreme zoom-out (<0.3x).
 * Category-colored dot with status ring + tiny label.
 */
function MinimalNodeInner({ data }: NodeProps<BaseNodeData>) {
  const fill = categoryFill[data.category] ?? "#94a3b8";
  const ring = statusRing[data.status] ?? "#9ca3af";

  return (
    <div className="flex flex-col items-center" role="treeitem" aria-label={`${data.kind}: ${data.name} — ${data.status}`}>
      <Handle type="target" position={Position.Left} className="!w-1 !h-1 !bg-transparent !border-0" />
      <div
        className="h-8 w-8 rounded-full shadow-sm"
        style={{
          backgroundColor: fill,
          boxShadow: `0 0 0 2.5px white, 0 0 0 4px ${ring}`,
        }}
        title={`${data.kind}: ${data.name}`}
        role="img"
        aria-label={`Status: ${data.status}`}
      />
      <div
        className="mt-1.5 max-w-[80px] truncate text-center text-[8px] font-medium"
        style={{ color: fill }}
      >
        {data.name}
      </div>
      <Handle type="source" position={Position.Right} className="!w-1 !h-1 !bg-transparent !border-0" />
    </div>
  );
}

export const MinimalNode = memo(MinimalNodeInner);
