/**
 * Cluster Organization Store — groups, favorites, environment tags, and fuzzy search.
 *
 * Persisted to localStorage so users keep their organization across sessions.
 * Designed for 20+ cluster environments where finding the right context matters.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Types ──────────────────────────────────────────────────────────────────

export type EnvironmentTag = 'production' | 'staging' | 'development' | 'testing';

export interface ClusterGroup {
  name: string;
  color: string;        // hex color for the group badge
  clusterIds: string[];
}

interface ClusterOrganizationState {
  /** Named groups of clusters (e.g. "Team Alpha", "US-East") */
  groups: Record<string, ClusterGroup>;
  /** Cluster IDs the user has favorited */
  favorites: string[];
  /** Cluster ID -> environment tag */
  envTags: Record<string, EnvironmentTag>;

  // ─── Group actions ──────────────────────────────────────────────────────
  addGroup: (id: string, name: string, color: string) => void;
  removeGroup: (id: string) => void;
  renameGroup: (id: string, name: string) => void;
  addToGroup: (groupId: string, clusterId: string) => void;
  removeFromGroup: (groupId: string, clusterId: string) => void;

  // ─── Favorite actions ───────────────────────────────────────────────────
  toggleFavorite: (clusterId: string) => void;
  isFavorite: (clusterId: string) => boolean;

  // ─── Environment tag actions ────────────────────────────────────────────
  setEnvTag: (clusterId: string, env: EnvironmentTag | null) => void;
  getEnvTag: (clusterId: string) => EnvironmentTag | undefined;
}

// ─── Environment colors ─────────────────────────────────────────────────────

export const ENV_DOT_COLORS: Record<EnvironmentTag, string> = {
  production: '#ef4444',   // red
  staging: '#f59e0b',      // amber
  development: '#22c55e',  // green
  testing: '#3b82f6',      // blue
};

export const ENV_LABELS: Record<EnvironmentTag, string> = {
  production: 'PROD',
  staging: 'STG',
  development: 'DEV',
  testing: 'TEST',
};

export const ENV_BADGE_CLASSES: Record<EnvironmentTag, string> = {
  production: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800',
  staging: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800',
  development: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800',
  testing: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/50 dark:text-sky-300 dark:border-sky-800',
};

// ─── Fuzzy search utility ───────────────────────────────────────────────────

/**
 * Simple fuzzy match: checks if all characters in the query appear in order
 * within the target string. Case-insensitive.
 */
export function fuzzyMatch(query: string, target: string): { matches: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (q.length === 0) return { matches: true, score: 1 };

  // Exact substring match gets highest score
  if (t.includes(q)) return { matches: true, score: 2 };

  // Character-by-character fuzzy
  let qi = 0;
  let consecutiveBonus = 0;
  let score = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutiveBonus++;
      score += consecutiveBonus;
    } else {
      consecutiveBonus = 0;
    }
  }

  return {
    matches: qi === q.length,
    score,
  };
}

// ─── Default group colors for quick-add ─────────────────────────────────────

export const GROUP_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#84cc16', // lime
  '#6366f1', // indigo
  '#f43f5e', // rose
];

// ─── Store ──────────────────────────────────────────────────────────────────

export const useClusterOrganizationStore = create<ClusterOrganizationState>()(
  persist(
    (set, get) => ({
      groups: {},
      favorites: [],
      envTags: {},

      // ── Groups ────────────────────────────────────────────────────────────
      addGroup: (id, name, color) =>
        set((state) => ({
          groups: {
            ...state.groups,
            [id]: { name, color, clusterIds: [] },
          },
        })),

      removeGroup: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.groups;
          return { groups: rest };
        }),

      renameGroup: (id, name) =>
        set((state) => {
          const group = state.groups[id];
          if (!group) return state;
          return {
            groups: {
              ...state.groups,
              [id]: { ...group, name },
            },
          };
        }),

      addToGroup: (groupId, clusterId) =>
        set((state) => {
          const group = state.groups[groupId];
          if (!group || group.clusterIds.includes(clusterId)) return state;
          return {
            groups: {
              ...state.groups,
              [groupId]: { ...group, clusterIds: [...group.clusterIds, clusterId] },
            },
          };
        }),

      removeFromGroup: (groupId, clusterId) =>
        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;
          return {
            groups: {
              ...state.groups,
              [groupId]: { ...group, clusterIds: group.clusterIds.filter((id) => id !== clusterId) },
            },
          };
        }),

      // ── Favorites ─────────────────────────────────────────────────────────
      toggleFavorite: (clusterId) =>
        set((state) => ({
          favorites: state.favorites.includes(clusterId)
            ? state.favorites.filter((id) => id !== clusterId)
            : [...state.favorites, clusterId],
        })),

      isFavorite: (clusterId) => get().favorites.includes(clusterId),

      // ── Environment tags ──────────────────────────────────────────────────
      setEnvTag: (clusterId, env) =>
        set((state) => {
          if (env === null) {
            const { [clusterId]: _, ...rest } = state.envTags;
            return { envTags: rest };
          }
          return { envTags: { ...state.envTags, [clusterId]: env } };
        }),

      getEnvTag: (clusterId) => get().envTags[clusterId],
    }),
    {
      name: 'kubilitics-cluster-organization',
    }
  )
);
