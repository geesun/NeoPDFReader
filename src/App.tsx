import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDocumentStore } from "./store/documentStore";
import { useSearchStore } from "./store/searchStore";
import { useViewStore } from "./store/viewStore";
import { useTabStore } from "./store/tabStore";
import { openFileDialog } from "./services/openFile";
import TabBar from "./components/TabBar";
import SearchPanel from "./components/SearchBar";
import Sidebar from "./components/Sidebar";
import PageViewport from "./components/PageViewport";
import StatusBar from "./components/StatusBar";
import type { IndexProgress, PageSize } from "./types";
import "./App.css";

interface PageSizesChunk {
  start: number;
  sizes: PageSize[];
}

function App() {
  const { appendPageSizes } = useDocumentStore();
  const { setIndexProgress, setIndexComplete } = useSearchStore();
  const theme = useViewStore((s) => s.theme);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const isHomeTab = activeTabId === "home";

  // Apply theme attribute to the root element
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Listen for backend events
  useEffect(() => {
    const unlistenProgress = listen<IndexProgress>("index-progress", (event) => {
      setIndexProgress(event.payload);
    });

    const unlistenComplete = listen("index-complete", () => {
      setIndexComplete();
    });

    // Stream remaining page sizes for large documents
    const unlistenChunk = listen<PageSizesChunk>("page-sizes-chunk", (event) => {
      appendPageSizes(event.payload.start, event.payload.sizes);
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenChunk.then((fn) => fn());
    };
  }, [setIndexProgress, setIndexComplete, appendPageSizes]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ctrl/Cmd+O: Open file
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        try {
          await openFileDialog();
        } catch (err) {
          console.error("Failed to open file:", err);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Handle drag and drop
  useEffect(() => {
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.name.toLowerCase().endsWith(".pdf")) {
          console.log("Dropped file:", file.name);
        }
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    window.addEventListener("drop", handleDrop);
    window.addEventListener("dragover", handleDragOver);
    return () => {
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragover", handleDragOver);
    };
  }, []);

  return (
    <div className="app">
      <TabBar />
      <div className="app-main">
        {!isHomeTab && <Sidebar />}
        <PageViewport />
        {!isHomeTab && <SearchPanel />}
      </div>
      {!isHomeTab && <StatusBar />}
    </div>
  );
}

export default App;
