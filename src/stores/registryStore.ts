import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { RegistryAgent } from "../types/registry";
import { getProviderColor } from "../types/registry";

/** Replace currentColor in SVG with actual color */
function colorizeIcon(dataUrl: string, agentId: string): string {
  const color = getProviderColor(agentId).main;

  // Extract base64 content
  const match = dataUrl.match(/^data:image\/svg\+xml;base64,(.+)$/);
  if (!match) return dataUrl;

  try {
    // Decode, replace currentColor, re-encode
    const svg = atob(match[1]);
    const colorized = svg.replace(/currentColor/gi, color);
    return `data:image/svg+xml;base64,${btoa(colorized)}`;
  } catch {
    return dataUrl;
  }
}

interface RegistryState {
  agents: RegistryAgent[];
  icons: Map<string, string>; // agent_id -> base64 data URL
  isLoading: boolean;
  error: string | null;
  lastFetch: number | null;

  // Actions
  fetchAgents: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  getIcon: (agentId: string) => Promise<string | null>;
  preloadIcons: () => Promise<void>;
  getAgent: (agentId: string) => RegistryAgent | undefined;
}

export const useRegistryStore = create<RegistryState>((set, get) => ({
  agents: [],
  icons: new Map(),
  isLoading: false,
  error: null,
  lastFetch: null,

  fetchAgents: async () => {
    // Skip if we fetched recently (within 5 minutes)
    const { lastFetch } = get();
    const now = Date.now();
    if (lastFetch && now - lastFetch < 5 * 60 * 1000) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const agents = await invoke<RegistryAgent[]>("get_registry_agents");

      // Fetch all cached icons and colorize them
      const iconsObj = await invoke<Record<string, string>>("get_all_agent_icons");
      const icons = new Map<string, string>();
      for (const [agentId, dataUrl] of Object.entries(iconsObj)) {
        icons.set(agentId, colorizeIcon(dataUrl, agentId));
      }

      set({ agents, icons, isLoading: false, lastFetch: now });
    } catch (error) {
      console.error("Failed to fetch registry agents:", error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
      });
    }
  },

  refreshAgents: async () => {
    set({ isLoading: true, error: null });

    try {
      await invoke("refresh_registry");
      const agents = await invoke<RegistryAgent[]>("get_registry_agents");

      // Fetch all cached icons and colorize them
      const iconsObj = await invoke<Record<string, string>>("get_all_agent_icons");
      const icons = new Map<string, string>();
      for (const [agentId, dataUrl] of Object.entries(iconsObj)) {
        icons.set(agentId, colorizeIcon(dataUrl, agentId));
      }

      set({ agents, icons, isLoading: false, lastFetch: Date.now() });
    } catch (error) {
      console.error("Failed to refresh registry:", error);
      set({
        error: error instanceof Error ? error.message : String(error),
        isLoading: false,
      });
    }
  },

  getIcon: async (agentId: string) => {
    const { icons } = get();

    // Return cached icon if available
    if (icons.has(agentId)) {
      return icons.get(agentId) || null;
    }

    try {
      const icon = await invoke<string | null>("get_agent_icon", { agentId });

      if (icon) {
        set((state) => {
          const newIcons = new Map(state.icons);
          newIcons.set(agentId, icon);
          return { icons: newIcons };
        });
      }

      return icon;
    } catch (error) {
      console.error(`Failed to fetch icon for ${agentId}:`, error);
      return null;
    }
  },

  preloadIcons: async () => {
    const { agents } = get();

    // Preload icons for all agents with icon URLs
    for (const agent of agents) {
      if (agent.icon) {
        // Fire and forget - don't await
        get().getIcon(agent.id);
      }
    }
  },

  getAgent: (agentId: string) => {
    return get().agents.find((a) => a.id === agentId);
  },
}));
