import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect, useRef } from 'react';

interface UIState {
    isSidebarCollapsed: boolean;
    /** Whether the sidebar was auto-collapsed by viewport resize (vs user choice) */
    isAutoCollapsed: boolean;
    setSidebarCollapsed: (collapsed: boolean) => void;
    toggleSidebar: () => void;
    setAutoCollapsed: (auto: boolean) => void;
}

const SIDEBAR_COLLAPSED_KEY = 'kubilitics-sidebar-collapsed';

/** P0-005-T02: Breakpoint at which sidebar auto-collapses */
const AUTO_COLLAPSE_BREAKPOINT = 1280;

export const useUIStore = create<UIState>()(
    persist(
        (set) => ({
            isSidebarCollapsed: false,
            isAutoCollapsed: false,
            setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed, isAutoCollapsed: false }),
            toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed, isAutoCollapsed: false })),
            setAutoCollapsed: (auto) => set({ isAutoCollapsed: auto }),
        }),
        {
            name: SIDEBAR_COLLAPSED_KEY,
            partialize: (state) => ({ isSidebarCollapsed: state.isSidebarCollapsed }),
        }
    )
);

/**
 * P0-005-T02: Auto-collapse sidebar at < 1280px.
 * Re-expand when viewport grows back, unless user manually collapsed.
 * Call this once in the layout component.
 */
export function useSidebarAutoCollapse() {
    const { isSidebarCollapsed, isAutoCollapsed, setSidebarCollapsed, setAutoCollapsed } = useUIStore();
    const wasManuallyCollapsed = useRef(false);

    useEffect(() => {
        const mq = window.matchMedia(`(max-width: ${AUTO_COLLAPSE_BREAKPOINT - 1}px)`);

        const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
            const isNarrow = 'matches' in e ? e.matches : false;

            if (isNarrow && !isSidebarCollapsed) {
                // Auto-collapse
                setSidebarCollapsed(true);
                setAutoCollapsed(true);
            } else if (!isNarrow && isSidebarCollapsed && isAutoCollapsed && !wasManuallyCollapsed.current) {
                // Auto-expand (only if it was auto-collapsed, not user choice)
                setSidebarCollapsed(false);
                setAutoCollapsed(false);
            }
        };

        handleChange(mq);
        mq.addEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
        return () => mq.removeEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
    }, [isSidebarCollapsed, isAutoCollapsed, setSidebarCollapsed, setAutoCollapsed]);
}
