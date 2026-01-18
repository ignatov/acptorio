import { useAgentStore } from "../../stores";
import { AgentCard } from "./AgentCard";

export function UnitPortraits() {
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentIds = useAgentStore((s) => s.selectedAgentIds);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  const agentList = Array.from(agents.values());

  const handleSelect = (agentId: string, e: React.MouseEvent) => {
    const multiSelect = e.ctrlKey || e.metaKey;
    selectAgent(agentId, multiSelect);
  };

  return (
    <section className="unit-portraits">
      <div className="unit-portraits__header">
        <span>Units ({agentList.length})</span>
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
          {selectedAgentIds.size > 0 && `${selectedAgentIds.size} selected`}
        </span>
      </div>
      <div className="unit-portraits__content">
        {agentList.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__text">
              No agents deployed. Click "Deploy" to start.
            </div>
          </div>
        ) : (
          agentList.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={selectedAgentIds.has(agent.id)}
              onSelect={(e) => handleSelect(agent.id, e)}
            />
          ))
        )}
      </div>
    </section>
  );
}
