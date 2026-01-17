import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Metrics } from "../types";

interface MetricsState {
  metrics: Metrics;
  isLoading: boolean;

  // Actions
  setMetrics: (metrics: Metrics) => void;
  addTokens: (input: number, output: number) => void;

  // Async actions
  fetchMetrics: () => Promise<void>;
  resetMetrics: () => Promise<void>;
}

const defaultMetrics: Metrics = {
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_tokens: 0,
  total_cost_dollars: 0,
  session_duration_secs: 0,
};

export const useMetricsStore = create<MetricsState>((set) => ({
  metrics: defaultMetrics,
  isLoading: false,

  setMetrics: (metrics) => set({ metrics }),

  addTokens: (input, output) => {
    set((state) => ({
      metrics: {
        ...state.metrics,
        total_input_tokens: state.metrics.total_input_tokens + input,
        total_output_tokens: state.metrics.total_output_tokens + output,
        total_tokens: state.metrics.total_tokens + input + output,
      },
    }));
  },

  fetchMetrics: async () => {
    set({ isLoading: true });
    try {
      const metrics = await invoke<Metrics>("get_metrics");
      set({ metrics, isLoading: false });
    } catch (e) {
      console.error("Failed to fetch metrics:", e);
      set({ isLoading: false });
    }
  },

  resetMetrics: async () => {
    try {
      await invoke("reset_metrics");
      set({ metrics: defaultMetrics });
    } catch (e) {
      console.error("Failed to reset metrics:", e);
    }
  },
}));
