import { useEffect, useRef } from "react";
import { useAgentStore } from "../../stores";

export function ActivityStream() {
  const activityLog = useAgentStore((s) => s.activityLog);
  const agents = useAgentStore((s) => s.agents);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [activityLog]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getEntryClass = (type: string) => {
    switch (type) {
      case "tool":
        return "activity-stream__entry--tool";
      case "error":
        return "activity-stream__entry--error";
      case "status":
        return "activity-stream__entry--status";
      default:
        return "";
    }
  };

  const getAgentName = (agentId: string) => {
    return agents.get(agentId)?.name ?? "Unknown";
  };

  if (activityLog.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📡</div>
        <div className="empty-state__title">No Activity</div>
        <div className="empty-state__text">
          Deploy an agent to see activity here
        </div>
      </div>
    );
  }

  return (
    <div className="activity-stream" ref={containerRef}>
      {activityLog.map((entry) => (
        <div
          key={entry.id}
          className={`activity-stream__entry ${getEntryClass(entry.type)}`}
        >
          <span className="activity-stream__time">
            [{formatTime(entry.timestamp)}]
          </span>
          <strong>[{getAgentName(entry.agentId)}]</strong> {entry.content}
        </div>
      ))}
    </div>
  );
}
