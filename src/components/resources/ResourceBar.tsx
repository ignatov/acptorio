import { useMetricsStore, useAgentStore, useProjectStore } from "../../stores";
import { TokenMeter } from "./TokenMeter";

export function ResourceBar() {
  const { metrics } = useMetricsStore();
  const agents = useAgentStore((s) => s.agents);
  const projectPath = useProjectStore((s) => s.projectPath);

  const projectName = projectPath?.split("/").pop() ?? "No Project";

  return (
    <header className="resource-bar">
      <div className="resource-bar__section">
        <div className="resource-bar__item">
          <span className="resource-bar__label">Project</span>
          <span className="resource-bar__value">{projectName}</span>
        </div>
        <div className="resource-bar__item">
          <span className="resource-bar__label">Agents</span>
          <span className="resource-bar__value">{agents.size}</span>
        </div>
      </div>

      <div className="resource-bar__section">
        <TokenMeter
          label="Tokens"
          current={metrics.total_tokens}
          max={1000000}
        />
        <div className="resource-bar__item">
          <span className="resource-bar__label">Cost</span>
          <span className="resource-bar__value resource-bar__value--cost">
            ${metrics.total_cost_dollars.toFixed(4)}
          </span>
        </div>
      </div>
    </header>
  );
}
