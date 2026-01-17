import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAgentStore, useProjectStore, useUIStore } from "../../stores";
import { TaskQueue } from "./TaskQueue";

export function CommandPanel() {
  const { commandInput, setCommandInput, addToHistory, navigateHistory } =
    useUIStore();
  const { selectedAgentIds, sendPrompt, spawnAgent } = useAgentStore();
  const { projectPath, loadProject, recentProjects } = useProjectStore();
  // Track which agents are currently executing (for visual feedback only)
  const [executingAgents, setExecutingAgents] = useState<Set<string>>(new Set());
  const [showRecentProjects, setShowRecentProjects] = useState(false);

  const handleOpenProject = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Close dropdown if open
    setShowRecentProjects(false);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Folder",
      });

      if (selected && typeof selected === "string") {
        await loadProject(selected);
      }
    } catch (err) {
      console.error("Failed to open project:", err);
      alert(`Failed to open project: ${err}`);
    }
  }, [loadProject]);

  const handleOpenRecent = useCallback(async (path: string) => {
    setShowRecentProjects(false);
    try {
      await loadProject(path);
    } catch (err) {
      console.error("Failed to open recent project:", err);
      alert(`Failed to open project: ${err}`);
    }
  }, [loadProject]);

  const handleSpawnAgent = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!projectPath) {
      alert("Please open a project first");
      return;
    }

    const name = `Agent-${Date.now().toString(36).toUpperCase()}`;
    try {
      await spawnAgent(name, projectPath);
    } catch (e) {
      console.error("Failed to spawn agent:", e);
      alert(`Failed to spawn agent: ${e}`);
    }
  }, [projectPath, spawnAgent]);

  const handleExecute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!commandInput.trim()) return;
    if (selectedAgentIds.size === 0) {
      alert("Select an agent first");
      return;
    }

    addToHistory(commandInput);
    const cmd = commandInput;
    const agentsToExecute = Array.from(selectedAgentIds);
    setCommandInput("");

    // Mark agents as executing
    setExecutingAgents((prev) => {
      const next = new Set(prev);
      agentsToExecute.forEach((id) => next.add(id));
      return next;
    });

    // Fire off commands in parallel without blocking the UI
    agentsToExecute.forEach((agentId) => {
      console.log(`Sending prompt to ${agentId}: ${cmd}`);
      sendPrompt(agentId, cmd)
        .then((result) => {
          console.log(`Result from ${agentId}:`, result);
        })
        .catch((err) => {
          console.error(`Failed for ${agentId}:`, err);
        })
        .finally(() => {
          // Remove from executing set when done
          setExecutingAgents((prev) => {
            const next = new Set(prev);
            next.delete(agentId);
            return next;
          });
        });
    });
  }, [commandInput, selectedAgentIds, sendPrompt, addToHistory, setCommandInput]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navigateHistory("up");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      navigateHistory("down");
    }
  };

  return (
    <aside className="command-panel">
      <div className="command-panel__header">Command Center</div>
      <div className="command-panel__content">
        <TaskQueue />
        <div className="command-panel__input-area">
          <textarea
            className="command-panel__input"
            placeholder={
              selectedAgentIds.size > 0
                ? "Enter command for selected agents..."
                : "Select an agent to issue commands"
            }
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            disabled={selectedAgentIds.size === 0}
          />
          <div className="command-panel__actions">
            <div style={{ position: "relative" }}>
              <button
                className="btn"
                onClick={handleOpenProject}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (recentProjects.length > 0) {
                    setShowRecentProjects(!showRecentProjects);
                  }
                }}
                title={recentProjects.length > 0 ? "Right-click for recent projects" : ""}
              >
                Open Project {recentProjects.length > 0 && "▾"}
              </button>
              {showRecentProjects && recentProjects.length > 0 && (
                <div className="recent-projects-dropdown" onClick={(e) => e.stopPropagation()}>
                  <div className="recent-projects-header">Recent Projects</div>
                  {recentProjects.map((project) => (
                    <div
                      key={project.path}
                      className="recent-project-item"
                      onClick={() => handleOpenRecent(project.path)}
                      title={project.path}
                    >
                      <span className="recent-project-name">{project.name}</span>
                      <span className="recent-project-path">{project.path}</span>
                    </div>
                  ))}
                  <div
                    className="recent-projects-close"
                    onClick={() => setShowRecentProjects(false)}
                  >
                    Close
                  </div>
                </div>
              )}
            </div>
            <button
              className="btn btn--success"
              onClick={handleSpawnAgent}
              disabled={!projectPath}
            >
              Deploy Agent
            </button>
            <button
              className="btn btn--primary"
              onClick={handleExecute}
              disabled={!commandInput.trim() || selectedAgentIds.size === 0}
            >
              {executingAgents.size > 0 ? `Executing (${executingAgents.size})...` : "Execute"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
