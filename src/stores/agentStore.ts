import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo, AgentUpdate } from "../types";

interface ActivityLogEntry {
  id: string;
  agentId: string;
  timestamp: Date;
  type: "message" | "tool" | "status" | "error";
  content: string;
  tool?: string;
}

interface AgentState {
  agents: Map<string, AgentInfo>;
  selectedAgentIds: Set<string>;
  activityLog: ActivityLogEntry[];

  // Actions
  addAgent: (agent: AgentInfo) => void;
  updateAgent: (agentId: string, update: Partial<AgentInfo>) => void;
  removeAgent: (agentId: string) => void;
  selectAgent: (agentId: string, multiSelect?: boolean) => void;
  setSelectedAgentIds: (ids: Set<string>) => void;
  deselectAgent: (agentId: string) => void;
  clearSelection: () => void;
  selectAllAgents: () => void;
  addActivityLog: (entry: Omit<ActivityLogEntry, "id" | "timestamp">) => void;
  clearActivityLog: () => void;
  handleAgentUpdate: (update: AgentUpdate) => void;

  // Async actions
  spawnAgent: (name: string, workingDirectory: string) => Promise<AgentInfo>;
  stopAgent: (agentId: string) => Promise<void>;
  sendPrompt: (agentId: string, prompt: string) => Promise<string>;
  fetchAgents: () => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: new Map(),
  selectedAgentIds: new Set(),
  activityLog: [],

  addAgent: (agent) => {
    set((state) => {
      const agents = new Map(state.agents);
      agents.set(agent.id, agent);
      return { agents };
    });
  },

  updateAgent: (agentId, update) => {
    set((state) => {
      const agents = new Map(state.agents);
      const existing = agents.get(agentId);
      if (existing) {
        agents.set(agentId, { ...existing, ...update });
      }
      return { agents };
    });
  },

  removeAgent: (agentId) => {
    set((state) => {
      const agents = new Map(state.agents);
      agents.delete(agentId);
      const selectedAgentIds = new Set(state.selectedAgentIds);
      selectedAgentIds.delete(agentId);
      return { agents, selectedAgentIds };
    });
  },

  selectAgent: (agentId, multiSelect = false) => {
    set((state) => {
      const selectedAgentIds = multiSelect
        ? new Set(state.selectedAgentIds)
        : new Set<string>();
      selectedAgentIds.add(agentId);
      return { selectedAgentIds };
    });
  },

  setSelectedAgentIds: (ids) => {
    set({ selectedAgentIds: ids });
  },

  deselectAgent: (agentId) => {
    set((state) => {
      const selectedAgentIds = new Set(state.selectedAgentIds);
      selectedAgentIds.delete(agentId);
      return { selectedAgentIds };
    });
  },

  clearSelection: () => {
    set({ selectedAgentIds: new Set() });
  },

  selectAllAgents: () => {
    set((state) => ({
      selectedAgentIds: new Set(state.agents.keys()),
    }));
  },

  addActivityLog: (entry) => {
    set((state) => ({
      activityLog: [
        ...state.activityLog,
        {
          ...entry,
          id: crypto.randomUUID(),
          timestamp: new Date(),
        },
      ].slice(-500), // Keep last 500 entries
    }));
  },

  clearActivityLog: () => {
    set({ activityLog: [] });
  },

  handleAgentUpdate: (update) => {
    const { updateAgent, addActivityLog } = get();

    // Update agent state
    const agentUpdate: Partial<AgentInfo> = {};
    if (update.progress !== null) {
      agentUpdate.progress = update.progress;
    }
    if (update.current_file !== null) {
      agentUpdate.current_file = update.current_file;
    }
    if (update.status !== null) {
      agentUpdate.status = update.status;
    }
    if (update.pending_inputs !== null) {
      agentUpdate.pending_inputs = update.pending_inputs;
    }
    updateAgent(update.agent_id, agentUpdate);

    // Add to activity log
    if (update.message) {
      addActivityLog({
        agentId: update.agent_id,
        type: "message",
        content: update.message,
      });
    }
    if (update.tool) {
      addActivityLog({
        agentId: update.agent_id,
        type: "tool",
        content: `Using tool: ${update.tool.name}`,
        tool: update.tool.name,
      });
    }
  },

  spawnAgent: async (name, workingDirectory) => {
    const agent = await invoke<AgentInfo>("spawn_agent", {
      name,
      workingDirectory,
    });
    get().addAgent(agent);
    get().addActivityLog({
      agentId: agent.id,
      type: "status",
      content: `Agent "${name}" deployed`,
    });
    return agent;
  },

  stopAgent: async (agentId) => {
    await invoke("stop_agent", { agentId });
    const agent = get().agents.get(agentId);
    get().removeAgent(agentId);
    get().addActivityLog({
      agentId,
      type: "status",
      content: `Agent "${agent?.name ?? agentId}" stopped`,
    });
  },

  sendPrompt: async (agentId, prompt) => {
    get().updateAgent(agentId, { status: "working", progress: 0 });
    get().addActivityLog({
      agentId,
      type: "message",
      content: `> ${prompt}`,
    });

    const result = await invoke<string>("send_prompt", { agentId, prompt });

    get().updateAgent(agentId, { status: "idle", progress: 100 });
    get().addActivityLog({
      agentId,
      type: "message",
      content: result,
    });

    return result;
  },

  fetchAgents: async () => {
    const agents = await invoke<AgentInfo[]>("list_agents");
    set({
      agents: new Map(agents.map((a) => [a.id, a])),
    });
  },
}));
