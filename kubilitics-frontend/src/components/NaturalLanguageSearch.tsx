/**
 * NaturalLanguageSearch — B-INT-012
 *
 * Hybrid search component:
 *   • Fires the onSearch callback (local client-side filtering) immediately
 *     so the resource table updates as-you-type.
 *   • Simultaneously queries the AI backend (debounced 350 ms) for live
 *     world-model resource matches and semantic error-pattern hints.
 *   • Displays AI results in a dropdown panel below the input field.
 *
 * Backend calls (via useNaturalLanguageSearch):
 *   GET  /api/v1/memory/resources?search=<q>&limit=10   → live K8s resources
 *   POST /api/v1/memory/vector/search  { type: "error_patterns" }  → patterns
 */

import { useState, useEffect, useRef } from 'react';
import { Search, X, Clock, Cpu, AlertTriangle, Loader2, Database } from 'lucide-react';
import { useNaturalLanguageSearch, AIResourceResult, AIVectorResult } from '@/hooks/useNaturalLanguageSearch';
import { cn } from '@/lib/utils';

// ─── Public contract (unchanged — backwards compatible) ───────────────────────

export interface SearchFilters {
  query: string;
  namespace?: string;
  status?: string[];
  healthScore?: { min?: number; max?: number };
  failureRisk?: string[];
  tags?: string[];
}

interface NaturalLanguageSearchProps {
  onSearch: (filters: SearchFilters) => void;
  placeholder?: string;
}

// ─── Local helpers ────────────────────────────────────────────────────────────

/** Parse the raw query string into structured filter hints for local filtering. */
function parseQueryToFilters(query: string): SearchFilters {
  const filters: SearchFilters = { query };
  const lq = query.toLowerCase();

  const nsMatch = lq.match(/(?:in|namespace)\s+([a-z0-9-]+)/);
  if (nsMatch) filters.namespace = nsMatch[1];

  const statusKeywords = ['running', 'pending', 'failed', 'succeeded', 'crashing', 'terminating'];
  const foundStatuses = statusKeywords.filter(s => lq.includes(s));
  if (foundStatuses.length) filters.status = foundStatuses;

  if (lq.includes('healthy')) {
    filters.healthScore = { min: 80 };
  } else if (lq.includes('unhealthy') || lq.includes('degraded')) {
    filters.healthScore = { max: 60 };
  }

  const foundRisks: string[] = [];
  if (lq.includes('critical')) foundRisks.push('critical');
  if (lq.includes('high risk') || lq.includes('high-risk')) foundRisks.push('high');
  if (lq.includes('medium risk') || lq.includes('medium-risk')) foundRisks.push('medium');
  if (lq.includes('low risk') || lq.includes('low-risk')) foundRisks.push('low');
  if (foundRisks.length) filters.failureRisk = foundRisks;

  return filters;
}

/** Health badge colour */
function healthColor(health?: string) {
  switch (health) {
    case 'critical': return 'text-red-600 bg-red-50 border-red-200';
    case 'warning':  return 'text-amber-600 bg-amber-50 border-amber-200';
    case 'healthy':  return 'text-green-600 bg-green-50 border-green-200';
    default:         return 'text-gray-500 bg-gray-50 border-gray-200';
  }
}

/** Kind → icon colour */
function kindColor(kind: string) {
  switch (kind.toLowerCase()) {
    case 'pod':        return 'text-blue-500';
    case 'deployment': return 'text-purple-500';
    case 'service':    return 'text-teal-500';
    case 'node':       return 'text-orange-500';
    default:           return 'text-gray-400';
  }
}

const SEARCH_EXAMPLES = [
  'failing pods in production',
  'high cpu usage',
  'unhealthy deployments',
  'critical risk pods',
];

const STORAGE_KEY = 'kubilitics-search-history';
const MAX_HISTORY = 5;

// ─── Component ────────────────────────────────────────────────────────────────

export function NaturalLanguageSearch({
  onSearch,
  placeholder = 'Search: "failing pods in production" or "high cpu usage"',
}: NaturalLanguageSearchProps) {
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { results, search: aiSearch, clear: aiClear } = useNaturalLanguageSearch();

  // Load search history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setHistory(JSON.parse(stored));
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  function addToHistory(q: string) {
    if (!q.trim()) return;
    const updated = [q, ...history.filter(h => h !== q)].slice(0, MAX_HISTORY);
    setHistory(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  }

  function applySearch(q: string) {
    const trimmed = q.trim();
    onSearch(parseQueryToFilters(trimmed));
    if (trimmed) {
      aiSearch(trimmed);
      addToHistory(trimmed);
    } else {
      aiClear();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    setShowDropdown(true);
    // Fire local filter immediately; AI search is debounced inside the hook
    onSearch(parseQueryToFilters(val));
    if (val.trim()) {
      aiSearch(val);
    } else {
      aiClear();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      applySearch(query);
      setShowDropdown(false);
    } else if (e.key === 'Escape') {
      setQuery('');
      setShowDropdown(false);
      aiClear();
      onSearch({ query: '' });
    }
  }

  function handleClear() {
    setQuery('');
    setShowDropdown(false);
    aiClear();
    onSearch({ query: '' });
    inputRef.current?.focus();
  }

  function handleHistoryClick(item: string) {
    setQuery(item);
    applySearch(item);
    setShowDropdown(false);
  }

  function handleExampleClick(example: string) {
    setQuery(example);
    applySearch(example);
    setShowDropdown(false);
  }

  function clearHistory() {
    setHistory([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  // ── Dropdown content decision ─────────────────────────────────────────────

  const hasQuery = query.trim().length > 0;
  const hasAIResults = results.resources.length > 0 || results.patterns.length > 0;
  const showHistory = !hasQuery && history.length > 0;
  const showExamples = !hasQuery && history.length === 0;
  const showAIPanel = hasQuery && (results.isLoading || hasAIResults || results.error);

  const dropdownVisible = showDropdown && (showHistory || showExamples || showAIPanel);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative w-full">
      {/* ── Input ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
          placeholder={placeholder}
          aria-label="Natural language search"
          className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 dark:placeholder-gray-500 transition-shadow"
        />
        {query && (
          <button
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Dropdown ── */}
      {dropdownVisible && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-[420px] overflow-y-auto">

          {/* ── History ── */}
          {showHistory && (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent</span>
                <button onClick={clearHistory} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  Clear
                </button>
              </div>
              {history.map((item, i) => (
                <button
                  key={i}
                  onClick={() => handleHistoryClick(item)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2 group"
                >
                  <Clock className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 truncate">{item}</span>
                </button>
              ))}
            </>
          )}

          {/* ── Examples ── */}
          {showExamples && (
            <>
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Try searching for</span>
              </div>
              {SEARCH_EXAMPLES.map(ex => (
                <button
                  key={ex}
                  onClick={() => handleExampleClick(ex)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2"
                >
                  <Search className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400 italic">{ex}</span>
                </button>
              ))}
            </>
          )}

          {/* ── AI loading spinner ── */}
          {showAIPanel && results.isLoading && (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
              <span>Searching cluster world-model…</span>
            </div>
          )}

          {/* ── AI error ── */}
          {showAIPanel && results.error && !results.isLoading && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{results.error}</span>
            </div>
          )}

          {/* ── AI resource results ── */}
          {showAIPanel && results.resources.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <Database className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Live Cluster Resources
                </span>
                <span className="ml-auto text-xs text-gray-400">{results.resources.length} match{results.resources.length !== 1 ? 'es' : ''}</span>
              </div>
              {results.resources.map((res: AIResourceResult) => (
                <ResourceRow
                  key={res.key ?? `${res.kind}/${res.namespace}/${res.name}`}
                  resource={res}
                  onSelect={() => {
                    handleHistoryClick(`${res.kind.toLowerCase()} ${res.name}`);
                  }}
                />
              ))}
            </>
          )}

          {/* ── AI pattern hints ── */}
          {showAIPanel && results.patterns.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-3 py-2 border-t border-gray-100 dark:border-gray-800">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Known Error Patterns
                </span>
              </div>
              {results.patterns.slice(0, 3).map((p: AIVectorResult) => (
                <PatternRow key={p.id} pattern={p} />
              ))}
            </>
          )}

          {/* ── No results ── */}
          {showAIPanel && !results.isLoading && !results.error &&
           results.resources.length === 0 && results.patterns.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
              No cluster resources matched <strong className="text-gray-600 dark:text-gray-300">"{query}"</strong>
            </div>
          )}
        </div>
      )}

      {/* ── Chip examples (shown below input when not focused) ── */}
      {!query && !showDropdown && (
        <div className="mt-2 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-gray-400">Try:</span>
          {SEARCH_EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => handleExampleClick(ex)}
              className="text-xs px-2 py-0.5 bg-gray-100 hover:bg-blue-50 hover:text-blue-700 dark:bg-gray-800 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 rounded-full text-gray-600 dark:text-gray-400 transition-colors border border-transparent hover:border-blue-200 dark:hover:border-blue-700"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ResourceRow({
  resource,
  onSelect,
}: {
  resource: AIResourceResult;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2.5 group transition-colors"
    >
      <Cpu className={cn('h-3.5 w-3.5 flex-shrink-0', kindColor(resource.kind))} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-mono text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            {resource.kind}
          </span>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
            {resource.name}
          </span>
          {resource.namespace && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
              ns:{resource.namespace}
            </span>
          )}
        </div>
      </div>
      {resource.health && (
        <span className={cn(
          'text-xs px-1.5 py-0.5 rounded border font-medium flex-shrink-0 capitalize',
          healthColor(resource.health)
        )}>
          {resource.health}
        </span>
      )}
    </button>
  );
}

function PatternRow({ pattern }: { pattern: AIVectorResult }) {
  // Show only the first line of the pattern text (avoid walls of text)
  const summary = pattern.text?.split('\n')[0]?.trim() ?? pattern.id;
  const short = summary.length > 100 ? summary.slice(0, 100) + '…' : summary;

  return (
    <div className="px-3 py-2 flex items-start gap-2.5 border-b border-gray-50 dark:border-gray-800 last:border-b-0">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{short}</p>
      {pattern.score > 0 && (
        <span className="ml-auto text-xs text-gray-300 dark:text-gray-600 flex-shrink-0 tabular-nums">
          {Math.round(pattern.score * 100)}%
        </span>
      )}
    </div>
  );
}
