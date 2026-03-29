import { create } from "zustand";

type SidebarTab = "thumbnails" | "bookmarks" | null;
type Theme = "dark" | "light";
export type ActiveTool = "hand" | "text-select";

interface ViewState {
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  theme: Theme;
  activeTool: ActiveTool;

  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: (tab: SidebarTab) => void;
  setSidebarWidth: (width: number) => void;
  toggleTheme: () => void;
  setActiveTool: (tool: ActiveTool) => void;
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
  activeTool: "hand",

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
  setActiveTool: (tool) => set({ activeTool: tool }),
}));
