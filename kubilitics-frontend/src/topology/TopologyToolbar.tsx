import { useState, useCallback, useRef } from "react";
import {
  Search, Download, Maximize, ChevronDown, FileJson, FileImage, FileType, Pen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ViewModeSelect } from "./components/ViewModeSelect";
import type { ViewMode, TopologyResponse } from "./types/topology";
import {
  exportTopologyJSON,
  exportTopologyPNG,
  exportTopologySVG,
  exportTopologyDrawIO,
} from "./export/exportTopology";
import { exportTopologyPDF } from "./export/exportPDF";
import type { SearchResult } from "./hooks/useTopologySearch";
import { categoryIcon } from "./nodes/nodeUtils";

export interface TopologyToolbarProps {
  viewMode?: ViewMode;
  namespace?: string;
  topology?: TopologyResponse | null;
  searchQuery?: string;
  searchResults?: SearchResult[];
  onViewModeChange?: (mode: ViewMode) => void;
  onNamespaceChange?: (ns: string) => void;
  onSearchChange?: (query: string) => void;
  onSearchSelect?: (nodeId: string) => void;
  onFitView?: () => void;
}

export function TopologyToolbar({
  viewMode = "namespace",
  topology,
  searchQuery = "",
  searchResults = [],
  onViewModeChange,
  onSearchChange,
  onSearchSelect,
  onFitView,
}: TopologyToolbarProps) {
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(e.target.value);
    setShowSearchResults(true);
  }, [onSearchChange]);

  const handleSearchSelect = useCallback((nodeId: string) => {
    onSearchSelect?.(nodeId);
    setShowSearchResults(false);
  }, [onSearchSelect]);

  return (
    <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          ref={searchRef}
          data-topology-search
          className="h-9 w-80 rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors"
          placeholder="Search (kind:Pod ns:default label:app=nginx) — /"
          value={searchQuery}
          onChange={handleSearch}
          onFocus={() => setShowSearchResults(true)}
          onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
        />
        {showSearchResults && searchResults.length > 0 && (
          <div className="absolute left-0 top-full z-50 mt-1.5 max-h-72 w-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="px-3 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
              {searchResults.length} results
            </div>
            {searchResults.map((r) => (
              <button
                key={r.node.id}
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-blue-50 transition-colors"
                onMouseDown={() => handleSearchSelect(r.node.id)}
              >
                <span className="text-base shrink-0">{categoryIcon(r.node.category)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">{r.node.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium shrink-0">
                      {r.node.kind}
                    </span>
                  </div>
                  {r.node.namespace && (
                    <div className="text-xs text-gray-400 truncate mt-0.5">{r.node.namespace}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View Mode Selector */}
      <ViewModeSelect value={viewMode} onChange={onViewModeChange} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Stats Badge */}
      {topology && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1">
            <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            <span className="font-medium text-gray-700">{topology.metadata.resourceCount}</span>
            <span>resources</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1">
            <div className="h-1.5 w-1.5 rounded-full bg-purple-400" />
            <span className="font-medium text-gray-700">{topology.metadata.edgeCount}</span>
            <span>edges</span>
          </div>
        </div>
      )}

      {/* Fit View */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={onFitView}
        title="Fit to view (F)"
      >
        <Maximize className="h-3.5 w-3.5" />
        Fit
      </Button>

      {/* Export */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={!topology}>
            <Download className="h-3.5 w-3.5" />
            Export
            <ChevronDown className="h-3 w-3 text-gray-400" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => exportTopologyJSON(topology ?? null)}>
            <FileJson className="h-3.5 w-3.5 mr-2" /> JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportTopologyPNG()}>
            <FileImage className="h-3.5 w-3.5 mr-2" /> PNG
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportTopologySVG()}>
            <FileImage className="h-3.5 w-3.5 mr-2" /> SVG
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportTopologyDrawIO(topology ?? null)}>
            <Pen className="h-3.5 w-3.5 mr-2" /> Draw.io
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportTopologyPDF(topology?.metadata?.clusterId, viewMode)}>
            <FileType className="h-3.5 w-3.5 mr-2" /> PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
