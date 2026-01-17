import type { AgentInfo } from "../../types";

interface AgentMarkerProps {
  agent: AgentInfo;
  x: number;
  y: number;
}

export function AgentMarker({ agent, x, y }: AgentMarkerProps) {
  const getColor = () => {
    switch (agent.status) {
      case "working":
        return "var(--accent-secondary)";
      case "error":
        return "var(--health-low)";
      case "idle":
        return "var(--accent-info)";
      default:
        return "var(--text-secondary)";
    }
  };

  return (
    <div
      className="agent-marker"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: getColor(),
        border: "2px solid var(--bg-panel)",
        boxShadow: `0 0 8px ${getColor()}`,
        cursor: "pointer",
        zIndex: 10,
      }}
      title={`${agent.name} - ${agent.status}`}
    />
  );
}
