import { create } from "zustand";

type SidebarTab = "thumbnails" | "bookmarks" | "search-results" | null;

interface ViewState {
  sidebarTab: SidebarTab;
  sidebarWidth: number;

  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: (tab: SidebarTab) => void;
  setSidebarWidth: (width: number) => void;
}

export const useViewStore = create<ViewState>((set, get) => ({
  sidebarTab: null,
  sidebarWidth: 240,

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  toggleSidebar: (tab) => {
    const current = get().sidebarTab;
    set({ sidebarTab: current === tab ? null : tab });
  },
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
}));
