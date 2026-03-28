import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPdf } from "./services/tauriApi";
import { useDocumentStore } from "./store/documentStore";
import { useSearchStore } from "./store/searchStore";
import Toolbar from "./components/Toolbar";
import SearchBar from "./components/SearchBar";
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
  const { setDocument, appendPageSizes } = useDocumentStore();
  const { setIndexProgress, setIndexComplete } = useSearchStore();

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
      // Ctrl+O: Open file
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        try {
          const selected = await open({
            filters: [{ name: "PDF", extensions: ["pdf"] }],
            multiple: false,
          });
          if (selected) {
            const path = typeof selected === "string" ? selected : selected;
            const info = await openPdf(path as string);
            setDocument(info, path as string);
          }
        } catch (err) {
          console.error("Failed to open file:", err);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setDocument]);

  // Handle drag and drop
  useEffect(() => {
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.name.toLowerCase().endsWith(".pdf")) {
          // Tauri drag-drop gives us file paths via webview
          // For now, just log — Tauri handles file drops differently
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
      <Toolbar />
      <SearchBar />
      <div className="app-main">
        <Sidebar />
        <PageViewport />
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
