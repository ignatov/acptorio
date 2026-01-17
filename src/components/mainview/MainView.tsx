import { useState } from "react";
import { useProjectStore } from "../../stores";
import { FileExplorer } from "./FileExplorer";
import { ActivityStream } from "./ActivityStream";

type ViewMode = "files" | "activity";

export function MainView() {
  const [viewMode, setViewMode] = useState<ViewMode>("activity");
  const selectedFile = useProjectStore((s) => s.selectedFile);

  return (
    <main className="main-view">
      <div className="main-view__header">
        <div className="main-view__title">
          {viewMode === "files" ? "File Explorer" : "Activity Stream"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`btn ${viewMode === "activity" ? "btn--primary" : ""}`}
            onClick={() => setViewMode("activity")}
          >
            Activity
          </button>
          <button
            className={`btn ${viewMode === "files" ? "btn--primary" : ""}`}
            onClick={() => setViewMode("files")}
          >
            Files
          </button>
        </div>
      </div>
      <div className="main-view__content">
        {viewMode === "activity" ? (
          <ActivityStream />
        ) : (
          <FileExplorer selectedFile={selectedFile} />
        )}
      </div>
    </main>
  );
}
