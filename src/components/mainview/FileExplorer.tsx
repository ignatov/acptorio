import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FileExplorerProps {
  selectedFile: string | null;
}

export function FileExplorer({ selectedFile }: FileExplorerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFile) {
      setContent(null);
      return;
    }

    setLoading(true);
    setError(null);

    invoke<string>("read_file", { path: selectedFile })
      .then((data) => {
        setContent(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [selectedFile]);

  if (!selectedFile) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📄</div>
        <div className="empty-state__title">No File Selected</div>
        <div className="empty-state__text">
          Select a file from the map to view its contents
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="empty-state__text">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">⚠️</div>
        <div className="empty-state__title">Error Reading File</div>
        <div className="empty-state__text">{error}</div>
      </div>
    );
  }

  const fileName = selectedFile.split("/").pop();

  return (
    <div>
      <div
        style={{
          marginBottom: 12,
          padding: "8px 12px",
          background: "var(--bg-secondary)",
          borderRadius: 4,
          fontSize: 12,
          color: "var(--text-secondary)",
        }}
      >
        {fileName}
      </div>
      <pre
        style={{
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontFamily: "inherit",
        }}
      >
        {content}
      </pre>
    </div>
  );
}
