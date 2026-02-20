import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
    isSidebarCollapsed: boolean;
    setSidebarCollapsed: (collapsed: boolean) => void;
    toggleSidebar: () => void;
}

const SIDEBAR_COLLAPSED_KEY = 'kubilitics-sidebar-collapsed';

export const useUIStore = create<UIState>()(
    persist(
        (set) => ({
            isSidebarCollapsed: false, // Default to expanded
            setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
            toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
        }),
        {
            name: SIDEBAR_COLLAPSED_KEY,
        }
    )
);
