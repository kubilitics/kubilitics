import { useState } from 'react';
import { Layers, SlidersHorizontal } from 'lucide-react';
import { NaturalLanguageSearch, SearchFilters } from './NaturalLanguageSearch';
import { SmartResourceGrouping, GroupByOption } from './SmartResourceGrouping';
import { useResourceHealth } from '@/hooks/useResourceHealth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

interface AIEnhancedResourceTableProps<T> {
  resources: T[];
  getResourceId: (resource: T) => string;
  getResourceType: (resource: T) => string;
  getResourceNamespace?: (resource: T) => string;
  getResourceName: (resource: T) => string;
  getResourceMetrics?: (resource: T) => {
    cpu?: number;
    memory?: number;
    restarts?: number;
    age?: number;
  };
  renderResource: (resource: T, showAIColumns: boolean) => React.ReactNode;
  enableAIColumns?: boolean;
}

export function AIEnhancedResourceTable<T>({
  resources,
  getResourceId,
  getResourceType,
  getResourceNamespace,
  getResourceName,
  getResourceMetrics,
  renderResource,
  enableAIColumns = true
}: AIEnhancedResourceTableProps<T>) {
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({ query: '' });
  const [groupBy, setGroupBy] = useState<GroupByOption>('none');
  const [showAIColumns, setShowAIColumns] = useState(enableAIColumns);

  // Prepare resources for health calculation
  const resourcesForHealth = resources.map(resource => ({
    id: getResourceId(resource),
    type: getResourceType(resource),
    namespace: getResourceNamespace?.(resource),
    name: getResourceName(resource),
    metrics: getResourceMetrics?.(resource)
  }));

  // Calculate health scores
  const { healthData, isLoading } = useResourceHealth({
    resources: resourcesForHealth,
    enabled: showAIColumns,
    refreshInterval: 60000
  });

  // Apply search filters
  const filteredResources = resources.filter(resource => {
    const id = getResourceId(resource);
    const name = getResourceName(resource).toLowerCase();
    const namespace = getResourceNamespace?.(resource)?.toLowerCase() || '';
    const health = healthData.get(id);

    // Text search
    if (searchFilters.query && !name.includes(searchFilters.query.toLowerCase())) {
      return false;
    }

    // Namespace filter
    if (searchFilters.namespace && namespace !== searchFilters.namespace.toLowerCase()) {
      return false;
    }

    // Health score filter
    if (searchFilters.healthScore && health) {
      if (searchFilters.healthScore.min && health.healthScore < searchFilters.healthScore.min) {
        return false;
      }
      if (searchFilters.healthScore.max && health.healthScore > searchFilters.healthScore.max) {
        return false;
      }
    }

    // Failure risk filter
    if (searchFilters.failureRisk && health) {
      if (!searchFilters.failureRisk.includes(health.failureRisk)) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="space-y-4">
      {/* Search and Controls */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <NaturalLanguageSearch
            onSearch={setSearchFilters}
            placeholder="Search: 'failing pods in production' or 'high cpu usage'"
          />
        </div>

        {/* Grouping Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Layers className="h-4 w-4" />
              Group By
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Group Resources</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setGroupBy('none')}>
              {groupBy === 'none' && '✓ '}None
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGroupBy('health')}>
              {groupBy === 'health' && '✓ '}Health Status
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGroupBy('risk')}>
              {groupBy === 'risk' && '✓ '}Failure Risk
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGroupBy('cost')}>
              {groupBy === 'cost' && '✓ '}Cost Tier
            </DropdownMenuItem>
            {getResourceNamespace && (
              <DropdownMenuItem onClick={() => setGroupBy('namespace')}>
                {groupBy === 'namespace' && '✓ '}Namespace
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* AI Columns Toggle */}
        {enableAIColumns && (
          <Button
            variant={showAIColumns ? 'default' : 'outline'}
            size="sm"
            className="gap-2"
            onClick={() => setShowAIColumns(!showAIColumns)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            AI Columns
          </Button>
        )}
      </div>

      {/* Results Summary */}
      <div className="text-sm text-gray-600">
        Showing {filteredResources.length} of {resources.length} resources
        {searchFilters.query && ` matching "${searchFilters.query}"`}
      </div>

      {/* Resource Table/List */}
      <SmartResourceGrouping
        resources={filteredResources}
        healthData={healthData}
        getResourceId={getResourceId}
        getResourceNamespace={getResourceNamespace}
        renderResource={(resource) => renderResource(resource, showAIColumns)}
        groupBy={groupBy}
      />

      {/* Empty State */}
      {filteredResources.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p>No resources found matching your search criteria</p>
        </div>
      )}
    </div>
  );
}
