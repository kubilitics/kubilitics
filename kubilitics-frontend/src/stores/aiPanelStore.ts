import { create } from 'zustand';

export interface AIContext {
  resourceKind?: string;
  resourceName?: string;
  namespace?: string;
  defaultQuery?: string;
}

interface AIPanelStore {
  isOpen: boolean;
  isExpanded: boolean;
  context: AIContext | null;
  pendingQuery: string | null;
  openWithContext: (ctx: AIContext) => void;
  open: () => void;
  close: () => void;
  toggleExpand: () => void;
  clearContext: () => void;
  setContext: (ctx: AIContext) => void;
  consumePendingQuery: () => string | null;
}

export const useAIPanelStore = create<AIPanelStore>((set, get) => ({
  isOpen: false,
  isExpanded: false,
  context: null,
  pendingQuery: null,

  openWithContext: (ctx: AIContext) =>
    set({ isOpen: true, context: ctx, pendingQuery: ctx.defaultQuery ?? null }),

  open: () => set({ isOpen: true }),

  close: () => set({ isOpen: false, context: null, pendingQuery: null }),

  toggleExpand: () => set((s) => ({ isExpanded: !s.isExpanded })),

  clearContext: () => set({ context: null }),

  setContext: (ctx: AIContext) => set({ context: ctx }),

  consumePendingQuery: () => {
    const query = get().pendingQuery;
    set({ pendingQuery: null });
    return query;
  },
}));
