export interface TopologyEmptyStateProps {
  type: "no-cluster" | "empty-cluster" | "empty-namespace" | "no-search-results";
  clusterId?: string | null;
  namespace?: string;
  searchQuery?: string;
}

/**
 * TopologyEmptyState: Contextual empty states for different scenarios.
 */
export function TopologyEmptyState({
  type,
  clusterId,
  namespace,
  searchQuery,
}: TopologyEmptyStateProps) {
  const configs: Record<string, { icon: string; title: string; description: string }> = {
    "no-cluster": {
      icon: "🔍",
      title: "Select a cluster",
      description: "Choose a cluster from the sidebar to view its topology.",
    },
    "empty-cluster": {
      icon: "📦",
      title: "No resources found",
      description: `No resources found in cluster "${clusterId ?? "unknown"}". This cluster may be empty or you may not have permissions to view resources.`,
    },
    "empty-namespace": {
      icon: "📁",
      title: `No workloads in ${namespace ?? "this namespace"}`,
      description: "This namespace doesn't contain any workloads. Try switching to a different namespace or viewing the cluster overview.",
    },
    "no-search-results": {
      icon: "🔎",
      title: "No resources match your search",
      description: `No results for "${searchQuery ?? ""}". Try a different search term or use syntax like kind:Pod, ns:default, or status:error.`,
    },
  };

  const config = configs[type] ?? configs["empty-cluster"];

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-gray-50/50">
      <div className="max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-5">
          <span className="text-3xl">{config.icon}</span>
        </div>
        <h2 className="mb-2 text-base font-semibold text-gray-800">{config.title}</h2>
        <p className="text-sm text-gray-500 leading-relaxed">{config.description}</p>
      </div>
    </div>
  );
}
