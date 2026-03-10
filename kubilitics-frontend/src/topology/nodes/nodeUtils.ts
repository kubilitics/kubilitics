/**
 * Shared utility functions for topology nodes.
 */

/** Returns an emoji icon for a resource category. */
export function categoryIcon(category: string): string {
  const icons: Record<string, string> = {
    compute: "\u2699\uFE0F",       // gear
    workload: "\u2699\uFE0F",      // gear (alias)
    networking: "\uD83C\uDF10",    // globe
    config: "\uD83D\uDCC4",       // page
    configuration: "\uD83D\uDCC4", // page (alias)
    storage: "\uD83D\uDCBE",      // floppy
    security: "\uD83D\uDD12",     // lock
    rbac: "\uD83D\uDD12",         // lock (alias)
    scheduling: "\uD83D\uDDA5\uFE0F", // desktop
    cluster: "\uD83D\uDDA5\uFE0F", // desktop (alias)
    scaling: "\uD83D\uDCC8",      // chart
    policy: "\uD83D\uDEE1\uFE0F",  // shield
    custom: "\uD83D\uDD37",       // diamond
  };
  return icons[category] || "\uD83D\uDD37";
}

/** Returns a Tailwind color class for a status indicator. */
export function statusColor(status: string): string {
  switch (status) {
    case "healthy":
    case "Running":
    case "Ready":
    case "Bound":
    case "Available":
      return "bg-emerald-500";
    case "warning":
    case "Pending":
    case "PartiallyAvailable":
      return "bg-amber-500";
    case "error":
    case "Failed":
    case "NotReady":
    case "Lost":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

/** Returns a Tailwind border color class for category. */
export function categoryBorderColor(category: string): string {
  const colors: Record<string, string> = {
    compute: "border-blue-300",
    workload: "border-blue-300",
    networking: "border-purple-300",
    config: "border-teal-300",
    configuration: "border-teal-300",
    storage: "border-orange-300",
    security: "border-rose-300",
    rbac: "border-rose-300",
    scheduling: "border-gray-300",
    cluster: "border-gray-300",
    scaling: "border-green-300",
    policy: "border-orange-300",
    custom: "border-indigo-300",
  };
  return colors[category] || "border-gray-200";
}

/** Returns a Tailwind background accent for category header. */
export function categoryHeaderBg(category: string): string {
  const colors: Record<string, string> = {
    compute: "bg-blue-500",
    workload: "bg-blue-500",
    networking: "bg-purple-500",
    config: "bg-teal-500",
    configuration: "bg-teal-500",
    storage: "bg-orange-500",
    security: "bg-rose-500",
    rbac: "bg-rose-500",
    scheduling: "bg-gray-500",
    cluster: "bg-gray-500",
    scaling: "bg-green-500",
    policy: "bg-orange-500",
    custom: "bg-indigo-500",
  };
  return colors[category] || "bg-gray-500";
}

/** Format bytes to human readable. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "Ki", "Mi", "Gi", "Ti"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/** Format millicores to human readable. */
export function formatCPU(millis: number): string {
  if (millis >= 1000) return (millis / 1000).toFixed(1) + " cores";
  return millis + "m";
}
