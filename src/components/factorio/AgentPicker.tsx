import { useEffect, useCallback, useState } from "react";
import { useRegistryStore } from "../../stores/registryStore";
import { getProviderColor, type RegistryAgent } from "../../types/registry";
import "./agent-picker.css";

interface AgentPickerProps {
  onSelect: (agent: RegistryAgent) => void;
  onClose: () => void;
}

export function AgentPicker({ onSelect, onClose }: AgentPickerProps) {
  const { agents, icons, isLoading, error, fetchAgents } = useRegistryStore();
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Fetch agents (and icons) on mount
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Enter" && agents.length > 0) {
        onSelect(agents[selectedIndex]);
        return;
      }

      const cols = Math.min(4, agents.length);
      if (e.key === "ArrowRight") {
        setSelectedIndex((i) => Math.min(i + 1, agents.length - 1));
      } else if (e.key === "ArrowLeft") {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "ArrowDown") {
        setSelectedIndex((i) => Math.min(i + cols, agents.length - 1));
      } else if (e.key === "ArrowUp") {
        setSelectedIndex((i) => Math.max(i - cols, 0));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [agents, selectedIndex, onSelect, onClose]);

  const handleAgentClick = useCallback(
    (agent: RegistryAgent) => {
      onSelect(agent);
    },
    [onSelect]
  );

  return (
    <div className="agent-picker-overlay" onClick={onClose}>
      <div className="agent-picker" onClick={(e) => e.stopPropagation()}>
        <div className="agent-picker__header">
          <h2 className="agent-picker__title">Select Agent Provider</h2>
          <button className="agent-picker__close" onClick={onClose}>
            ×
          </button>
        </div>

        {isLoading && agents.length === 0 && (
          <div className="agent-picker__loading">Loading providers...</div>
        )}

        {error && (
          <div className="agent-picker__error">
            Failed to load providers. Using cached data.
          </div>
        )}

        <div className="agent-picker__grid">
          {agents.map((agent, index) => {
            const colors = getProviderColor(agent.id);
            const icon = icons.get(agent.id);
            const isSelected = index === selectedIndex;

            return (
              <button
                key={agent.id}
                className={`agent-picker__card ${isSelected ? "agent-picker__card--selected" : ""}`}
                onClick={() => handleAgentClick(agent)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  "--provider-color": colors.main,
                  "--provider-color-light": colors.light,
                  "--provider-color-dark": colors.dark,
                } as React.CSSProperties}
              >
                <div className="agent-picker__card-icon">
                  {icon ? (
                    <img src={icon} alt={agent.name} />
                  ) : (
                    <div
                      className="agent-picker__card-icon-placeholder"
                      style={{ backgroundColor: colors.main }}
                    >
                      {agent.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="agent-picker__card-info">
                  <span className="agent-picker__card-name">{agent.name}</span>
                  <span className="agent-picker__card-version">v{agent.version}</span>
                </div>
                <div
                  className="agent-picker__card-color-bar"
                  style={{ backgroundColor: colors.main }}
                />
              </button>
            );
          })}
        </div>

        <div className="agent-picker__footer">
          <span className="agent-picker__hint">
            Use arrow keys to navigate, Enter to select, Escape to cancel
          </span>
        </div>
      </div>
    </div>
  );
}
