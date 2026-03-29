import { create } from "zustand";

interface NavigationState {
  backStack: number[];
  forwardStack: number[];

  /** Push current page onto backStack and navigate to target.
   *  Returns the target page (for chaining). */
  pushNavigation: (currentPage: number, targetPage: number) => number;

  /** Go back: pop from backStack, push current page onto forwardStack.
   *  Returns the page to navigate to, or null if backStack is empty. */
  goBack: (currentPage: number) => number | null;

  /** Go forward: pop from forwardStack, push current page onto backStack.
   *  Returns the page to navigate to, or null if forwardStack is empty. */
  goForward: (currentPage: number) => number | null;

  /** Clear both stacks (e.g. when a new document is opened). */
  clearHistory: () => void;

  canGoBack: () => boolean;
  canGoForward: () => boolean;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  backStack: [],
  forwardStack: [],

  pushNavigation: (currentPage, targetPage) => {
    set((state) => ({
      backStack: [...state.backStack, currentPage],
      forwardStack: [], // Clear forward on new navigation
    }));
    return targetPage;
  },

  goBack: (currentPage) => {
    const { backStack } = get();
    if (backStack.length === 0) return null;
    const target = backStack[backStack.length - 1];
    set((state) => ({
      backStack: state.backStack.slice(0, -1),
      forwardStack: [...state.forwardStack, currentPage],
    }));
    return target;
  },

  goForward: (currentPage) => {
    const { forwardStack } = get();
    if (forwardStack.length === 0) return null;
    const target = forwardStack[forwardStack.length - 1];
    set((state) => ({
      forwardStack: state.forwardStack.slice(0, -1),
      backStack: [...state.backStack, currentPage],
    }));
    return target;
  },

  clearHistory: () => set({ backStack: [], forwardStack: [] }),

  canGoBack: () => get().backStack.length > 0,
  canGoForward: () => get().forwardStack.length > 0,
}));
