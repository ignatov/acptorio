import { invoke } from "@tauri-apps/api/core";
import { useAgentStore } from "../../stores";
import type { PendingInput } from "../../types";

export function TaskQueue() {
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentIds = useAgentStore((s) => s.selectedAgentIds);

  const workingAgents = Array.from(agents.values()).filter(
    (a) => a.status === "working"
  );

  // Get pending inputs from selected agents
  const selectedAgents = Array.from(selectedAgentIds)
    .map((id) => agents.get(id))
    .filter(Boolean);

  const pendingInputs: Array<{ agentId: string; agentName: string; input: PendingInput }> = [];
  for (const agent of selectedAgents) {
    if (agent && agent.pending_inputs) {
      for (const input of agent.pending_inputs) {
        pendingInputs.push({ agentId: agent.id, agentName: agent.name, input });
      }
    }
  }

  const handlePermissionResponse = async (agentId: string, inputId: string, approved: boolean) => {
    console.log(`Responding to permission:`, { agentId, inputId, approved, typeOfAgentId: typeof agentId });
    try {
      const params = {
        agentId: String(agentId),
        inputId: String(inputId),
        approved,
        optionId: null as string | null,
      };
      console.log("Invoke params:", params);
      await invoke("respond_to_permission", params);
      console.log(`Permission ${approved ? "approved" : "denied"} for ${inputId}`);
    } catch (error) {
      console.error("Failed to respond to permission:", error);
    }
  };

  // Also get pending inputs from all agents (for visibility)
  const allPendingAgents = Array.from(agents.values()).filter(
    (a) => a.pending_inputs && a.pending_inputs.length > 0
  );

  const showNoContent =
    workingAgents.length === 0 &&
    pendingInputs.length === 0 &&
    allPendingAgents.length === 0;

  if (showNoContent) {
    return (
      <div className="command-panel__queue">
        <div
          style={{
            textAlign: "center",
            color: "var(--text-dim)",
            fontSize: 12,
            padding: 16,
          }}
        >
          No active tasks
        </div>
      </div>
    );
  }

  return (
    <div className="command-panel__queue">
      {/* Pending Inputs Section */}
      {pendingInputs.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: "bold",
              color: "#ffc107",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ⚠️ AGENT NEEDS INPUT
          </div>
          {pendingInputs.map(({ agentId, agentName, input }) => (
            <div
              key={input.id}
              style={{
                padding: "10px 12px",
                marginBottom: 8,
                background: "rgba(255, 193, 7, 0.1)",
                borderRadius: 4,
                borderLeft: "3px solid #ffc107",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-dim)",
                  marginBottom: 4,
                }}
              >
                {agentName} • {getInputTypeLabel(input.input_type)}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-primary)",
                  marginBottom: 8,
                }}
              >
                {input.message}
              </div>
              {input.tool_name && (
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--accent-primary)",
                    marginBottom: 8,
                  }}
                >
                  Tool: {input.tool_name}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, position: "relative", zIndex: 10 }}>
                <button
                  type="button"
                  className="btn btn--success"
                  style={{ fontSize: 10, padding: "4px 12px", cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePermissionResponse(agentId, input.id, true);
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: 10, padding: "4px 12px", cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePermissionResponse(agentId, input.id, false);
                  }}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alert for unselected agents with pending inputs */}
      {allPendingAgents.length > 0 && pendingInputs.length === 0 && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: 12,
            background: "rgba(255, 193, 7, 0.1)",
            borderRadius: 4,
            borderLeft: "3px solid #ffc107",
            fontSize: 11,
            color: "#ffc107",
          }}
        >
          ⚠️ {allPendingAgents.length} agent(s) need input. Select to view.
        </div>
      )}

      {/* Working Agents Section */}
      {workingAgents.map((agent) => (
        <div
          key={agent.id}
          style={{
            padding: "8px 12px",
            marginBottom: 8,
            background: "var(--bg-secondary)",
            borderRadius: 4,
            borderLeft: "3px solid var(--accent-secondary)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: "bold",
              marginBottom: 4,
            }}
          >
            {agent.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              marginBottom: 6,
            }}
          >
            {agent.current_file
              ? `Working on: ${agent.current_file.split("/").pop()}`
              : "Processing..."}
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar__fill progress-bar__fill--health"
              style={{ width: `${agent.progress}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function getInputTypeLabel(type: string): string {
  switch (type) {
    case "tool_permission":
      return "Permission Request";
    case "user_question":
      return "Question";
    case "confirmation":
      return "Confirmation";
    default:
      return "Input Required";
  }
}
