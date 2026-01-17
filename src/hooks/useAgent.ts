import { useCallback } from "react";
import { useAgentStore } from "../stores";

export function useAgent(agentId?: string) {
  const store = useAgentStore();

  const agent = agentId ? store.agents.get(agentId) : undefined;
  const isSelected = agentId ? store.selectedAgentIds.has(agentId) : false;

  const spawn = useCallback(
    async (name: string, workingDirectory: string) => {
      return store.spawnAgent(name, workingDirectory);
    },
    [store]
  );

  const stop = useCallback(async () => {
    if (agentId) {
      await store.stopAgent(agentId);
    }
  }, [store, agentId]);

  const sendPrompt = useCallback(
    async (prompt: string) => {
      if (agentId) {
        return store.sendPrompt(agentId, prompt);
      }
      throw new Error("No agent selected");
    },
    [store, agentId]
  );

  const select = useCallback(
    (multiSelect = false) => {
      if (agentId) {
        store.selectAgent(agentId, multiSelect);
      }
    },
    [store, agentId]
  );

  const deselect = useCallback(() => {
    if (agentId) {
      store.deselectAgent(agentId);
    }
  }, [store, agentId]);

  return {
    agent,
    isSelected,
    spawn,
    stop,
    sendPrompt,
    select,
    deselect,
    allAgents: Array.from(store.agents.values()),
    selectedAgents: Array.from(store.selectedAgentIds)
      .map((id) => store.agents.get(id))
      .filter(Boolean),
  };
}
