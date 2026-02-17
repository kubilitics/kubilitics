/**
 * useNaturalLanguageSearch — B-INT-012: AI-powered natural language search
 *
 * Calls two real AI backend endpoints:
 *   1. GET  /api/v1/memory/resources?search=<query>&limit=10
 *      → Keyword search over the live world-model (pods, deployments, services …)
 *
 *   2. POST /api/v1/memory/vector/search  { query, type: "error_patterns", limit: 5 }
 *      → Semantic/keyword search over indexed error patterns for contextual hints
 *
 * Returns debounced results so the UI doesn't hammer the backend on every keystroke.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { AI_BASE_URL } from '@/services/aiService';

// ─── Response shapes from the AI backend ─────────────────────────────────────

/** A K8s resource returned by GET /api/v1/memory/resources */
export interface AIResourceResult {
  key: string;           // "<namespace>/<kind>/<name>" or "<kind>/<name>"
  kind: string;
  name: string;
  namespace: string;
  health?: string;       // "healthy" | "warning" | "critical" | "unknown"
  labels?: Record<string, string>;
  /** Score assigned by multi-term keyword matching (higher = more relevant) */
  score?: number;
}

/** A vector-store hit returned by POST /api/v1/memory/vector/search */
export interface AIVectorResult {
  id: string;
  text: string;
  score: number;
  payload?: Record<string, unknown>;
}

export interface NaturalLanguageSearchResult {
  resources: AIResourceResult[];
  patterns: AIVectorResult[];
  isLoading: boolean;
  error: string | null;
}

const DEBOUNCE_MS = 350;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNaturalLanguageSearch(): {
  results: NaturalLanguageSearchResult;
  search: (query: string) => void;
  clear: () => void;
} {
  const [resources, setResources] = useState<AIResourceResult[]>([]);
  const [patterns, setPatterns] = useState<AIVectorResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResources([]);
      setPatterns([]);
      setError(null);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setIsLoading(true);
    setError(null);

    try {
      // Run both searches concurrently; partial failure is OK
      const [resourcesRes, patternsRes] = await Promise.allSettled([
        // 1. World-model resource search
        fetch(
          `${AI_BASE_URL}/api/v1/memory/resources?search=${encodeURIComponent(query)}&limit=10`,
          { signal }
        ).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),

        // 2. Semantic error-pattern search
        fetch(`${AI_BASE_URL}/api/v1/memory/vector/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, type: 'error_patterns', limit: 5 }),
          signal,
        }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      ]);

      if (resourcesRes.status === 'fulfilled') {
        const data = resourcesRes.value;
        // Backend returns { resources: [...], count: N }
        setResources(Array.isArray(data.resources) ? data.resources : []);
      } else if (resourcesRes.reason?.name !== 'AbortError') {
        console.warn('[NLSearch] resources fetch failed:', resourcesRes.reason);
      }

      if (patternsRes.status === 'fulfilled') {
        const data = patternsRes.value;
        // Backend returns { results: [...], count: N }
        setPatterns(Array.isArray(data.results) ? data.results : []);
      } else if (patternsRes.reason?.name !== 'AbortError') {
        console.warn('[NLSearch] vector search failed:', patternsRes.reason);
      }

      // Surface a user error only when BOTH failed
      if (
        resourcesRes.status === 'rejected' &&
        patternsRes.status === 'rejected' &&
        resourcesRes.reason?.name !== 'AbortError'
      ) {
        setError('AI search unavailable — check kubilitics-ai is running');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const search = useCallback(
    (query: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => doSearch(query), DEBOUNCE_MS);
    },
    [doSearch],
  );

  const clear = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    abortRef.current?.abort();
    setResources([]);
    setPatterns([]);
    setError(null);
    setIsLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    results: { resources, patterns, isLoading, error },
    search,
    clear,
  };
}
