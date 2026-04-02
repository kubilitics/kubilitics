/**
 * DiffNode — Custom React Flow node for topology diff visualization.
 *
 * Renders a node card with diff-aware styling:
 * - Added:     green border, green-50 bg, "+" badge top-right
 * - Removed:   red border (dashed), red-50 bg, "-" badge top-right
 * - Unchanged: default styling with opacity-50 (dimmed to emphasize changes)
 */
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { K8sIcon } from "../icons/K8sIcon";
import { cn } from "@/lib/utils";

export type DiffStatus = 'added' | 'removed' | 'unchanged';

export interface DiffNodeData {
  label: string;
  kind: string;
  namespace: string;
  health?: string;
  diffStatus: DiffStatus;
  [key: string]: unknown;
}

const DIFF_STYLES: Record<DiffStatus, {
  border: string;
  bg: string;
  badgeClass: string;
  badgeText: string;
  opacity: string;
}> = {
  added: {
    border: "border-green-500 dark:border-green-400 border-2",
    bg: "bg-green-50/80 dark:bg-green-950/30",
    badgeClass: "bg-green-500 text-white",
    badgeText: "+",
    opacity: "",
  },
  removed: {
    border: "border-red-500 dark:border-red-400 border-2 border-dashed",
    bg: "bg-red-50/80 dark:bg-red-950/30",
    badgeClass: "bg-red-500 text-white",
    badgeText: "\u2212",
    opacity: "",
  },
  unchanged: {
    border: "border-gray-200 dark:border-slate-700 border",
    bg: "bg-white dark:bg-slate-800",
    badgeClass: "",
    badgeText: "",
    opacity: "opacity-50",
  },
};

function DiffNodeInner({ data }: NodeProps) {
  const d = data as DiffNodeData;
  const status = d.diffStatus ?? 'unchanged';
  const style = DIFF_STYLES[status];

  return (
    <div
      className={cn(
        "relative w-[240px] rounded-lg shadow-sm transition-all duration-150",
        style.border,
        style.bg,
        style.opacity,
      )}
      role="treeitem"
      aria-roledescription="topology diff node"
      aria-label={`${d.kind}: ${d.label}, ${status}`}
      tabIndex={0}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-gray-400 dark:!bg-gray-500 !border-white !border-2"
      />

      {/* Diff badge */}
      {style.badgeText && (
        <span
          className={cn(
            "absolute -top-2 -right-2 z-10 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold shadow-sm",
            style.badgeClass,
          )}
          aria-label={status === 'added' ? 'Added' : 'Removed'}
        >
          {style.badgeText}
        </span>
      )}

      {/* Header */}
      <div className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-t-lg",
        status === 'added' ? "bg-green-600/90" : status === 'removed' ? "bg-red-600/90" : "bg-slate-500",
      )}>
        <K8sIcon kind={d.kind} size={16} backdrop />
        <span className="flex-1 text-xs font-semibold text-white tracking-wide uppercase truncate">
          {d.kind}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1">
        <div
          className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-snug"
          title={d.label}
        >
          {d.label}
        </div>
        {d.namespace && (
          <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
            {d.namespace}
          </div>
        )}
        {d.health && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              d.health === 'healthy' ? "bg-emerald-500" :
              d.health === 'warning' ? "bg-amber-500" :
              d.health === 'error' ? "bg-red-500" :
              "bg-gray-400",
            )} />
            <span className="text-[10px] text-gray-500 dark:text-gray-400 capitalize">
              {d.health}
            </span>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-gray-400 dark:!bg-gray-500 !border-white !border-2"
      />
    </div>
  );
}

export const DiffNode = memo(DiffNodeInner);
