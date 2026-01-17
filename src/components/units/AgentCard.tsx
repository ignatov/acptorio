import type { AgentInfo } from "../../types";
import { HealthBar } from "./HealthBar";
import { ManaBar } from "./ManaBar";
import { useAgentStore } from "../../stores";

interface AgentCardProps {
  agent: AgentInfo;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}

export function AgentCard({ agent, isSelected, onSelect }: AgentCardProps) {
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const hasPendingInputs = agent.pending_inputs && agent.pending_inputs.length > 0;

  const getStatusClass = () => {
    if (hasPendingInputs) return "agent-card--attention";
    switch (agent.status) {
      case "working":
        return "agent-card--working";
      case "paused":
        return "agent-card--attention";
      case "error":
        return "agent-card--error";
      default:
        return "";
    }
  };

  const getStatusLabel = () => {
    if (hasPendingInputs) return "INPUT";
    switch (agent.status) {
      case "initializing":
        return "INIT";
      case "idle":
        return "IDLE";
      case "working":
        return "WORK";
      case "paused":
        return "PAUSE";
      case "error":
        return "ERR";
      case "stopped":
        return "STOP";
      default:
        return agent.status;
    }
  };

  const getAvatarEmoji = () => {
    const emojis = ["🤖", "🦾", "⚡", "🔮", "🎯", "🚀"];
    const index = agent.name.charCodeAt(agent.name.length - 1) % emojis.length;
    return emojis[index];
  };

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Stop agent "${agent.name}"?`)) {
      stopAgent(agent.id);
    }
  };

  return (
    <div
      className={`agent-card ${isSelected ? "agent-card--selected" : ""} ${getStatusClass()}`}
      onClick={onSelect}
    >
      {hasPendingInputs && (
        <div className="agent-card__badge" title="Agent needs input">
          {agent.pending_inputs.length}
        </div>
      )}
      <div className="agent-card__header">
        <div className="agent-card__avatar">{getAvatarEmoji()}</div>
        <div className="agent-card__name">{agent.name}</div>
        <div className={`agent-card__status agent-card__status--${hasPendingInputs ? "attention" : agent.status}`}>
          {getStatusLabel()}
        </div>
      </div>

      <div className="agent-card__bars">
        <HealthBar value={agent.progress} />
        <ManaBar current={agent.tokens_used} max={agent.token_limit} />
      </div>

      {agent.current_file && (
        <div className="agent-card__file" title={agent.current_file}>
          📄 {agent.current_file.split("/").pop()}
        </div>
      )}

      {hasPendingInputs && (
        <div className="agent-card__pending-alert">
          ⚠️ Needs input ({agent.pending_inputs.length})
        </div>
      )}

      <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
        <button
          className="btn"
          style={{ fontSize: 10, padding: "4px 8px", flex: 1 }}
          onClick={handleStop}
        >
          Stop
        </button>
      </div>
    </div>
  );
}
