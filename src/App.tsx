import { useEffect } from "react";
import { RTSLayout } from "./components/layout/RTSLayout";
import { useTauriEvents } from "./hooks";
import { useAgentStore, useMetricsStore, useProjectStore } from "./stores";
import "./styles/rts.css";

function App() {
  useTauriEvents();

  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchMetrics = useMetricsStore((s) => s.fetchMetrics);
  const loadLastProject = useProjectStore((s) => s.loadLastProject);

  useEffect(() => {
    fetchAgents();
    fetchMetrics();

    // Load the last opened project
    loadLastProject();

    // Periodically refresh metrics
    const interval = setInterval(() => {
      fetchMetrics();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchAgents, fetchMetrics, loadLastProject]);

  return <RTSLayout />;
}

export default App;
