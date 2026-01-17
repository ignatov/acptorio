import { useEffect } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useAgentStore, useProjectStore } from "../stores";
import type { AgentInfo, AgentUpdate, FileEvent, ProjectTree } from "../types";

export function useTauriEvents() {
  const { addAgent, updateAgent, removeAgent, handleAgentUpdate, addActivityLog } =
    useAgentStore();
  const { setProjectTree, revealPath, addFile, removeFile } = useProjectStore();

  useEffect(() => {
    const listeners: Promise<UnlistenFn>[] = [];

    // Agent events
    listeners.push(
      listen<AgentInfo>("agent-spawned", (event) => {
        addAgent(event.payload);
      })
    );

    listeners.push(
      listen<AgentUpdate>("agent-update", (event) => {
        handleAgentUpdate(event.payload);
      })
    );

    listeners.push(
      listen<AgentInfo>("agent-status-changed", (event) => {
        updateAgent(event.payload.id, event.payload);
      })
    );

    listeners.push(
      listen<string>("agent-stopped", (event) => {
        removeAgent(event.payload);
      })
    );

    // Project events
    listeners.push(
      listen<ProjectTree>("project-loaded", (event) => {
        setProjectTree(event.payload);
      })
    );

    listeners.push(
      listen<FileEvent>("fs-change", (event) => {
        const { kind, paths } = event.payload;

        for (const path of paths) {
          // Skip temporary files and hidden system files
          const fileName = path.split("/").pop() || "";
          if (
            fileName.includes(".tmp") ||
            fileName.endsWith("~") ||
            fileName.startsWith(".#") ||
            path.includes("/node_modules/") ||
            path.includes("/.git/") ||
            path.includes("/target/")
          ) {
            continue;
          }

          console.log("File system change:", kind, path);

          if (kind === "create") {
            addFile(path);
          } else if (kind === "remove") {
            removeFile(path);
          }
        }
      })
    );

    listeners.push(
      listen<string>("fog-revealed", (event) => {
        revealPath(event.payload);
      })
    );

    // Cleanup
    return () => {
      listeners.forEach((promise) => {
        promise.then((unlisten) => unlisten());
      });
    };
  }, [
    addAgent,
    updateAgent,
    removeAgent,
    handleAgentUpdate,
    addActivityLog,
    setProjectTree,
    revealPath,
    addFile,
    removeFile,
  ]);
}
