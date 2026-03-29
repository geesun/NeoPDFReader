import { create } from "zustand";

type SidebarTab = "thumbnails" | "bookmarks" | null;
type Theme = "dark" | "light";

interface ViewState {
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  theme: Theme;

  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: (tab: SidebarTab) => void;
  setSidebarWidth: (width: number) => void;
  toggleTheme: () => void;
}

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem("neo-pdf-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* ignore */ }
  return "dark";
}

export const useViewStore = create<ViewState>((set, get) => ({
  sidebarTab: null,
  sidebarWidth: 240,
  theme: getInitialTheme(),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  toggleSidebar: (tab) => {
    const current = get().sidebarTab;
    set({ sidebarTab: current === tab ? null : tab });
  },
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("neo-pdf-theme", next); } catch { /* ignore */ }
    set({ theme: next });
  },
}));
