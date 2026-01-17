import { create } from "zustand";

type Panel = "minimap" | "mainview" | "command" | "units";

interface UIState {
  // Panel visibility
  panelVisibility: Record<Panel, boolean>;

  // Command input
  commandInput: string;
  commandHistory: string[];
  historyIndex: number;

  // Minimap
  minimapZoom: number;
  minimapCenter: { x: number; y: number };

  // Selection
  isBoxSelecting: boolean;
  boxSelectStart: { x: number; y: number } | null;
  boxSelectEnd: { x: number; y: number } | null;

  // Modal
  activeModal: string | null;
  modalData: Record<string, unknown> | null;

  // Actions
  togglePanel: (panel: Panel) => void;
  setCommandInput: (input: string) => void;
  addToHistory: (command: string) => void;
  navigateHistory: (direction: "up" | "down") => void;
  setMinimapZoom: (zoom: number) => void;
  setMinimapCenter: (center: { x: number; y: number }) => void;
  startBoxSelect: (point: { x: number; y: number }) => void;
  updateBoxSelect: (point: { x: number; y: number }) => void;
  endBoxSelect: () => void;
  openModal: (modalId: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  panelVisibility: {
    minimap: true,
    mainview: true,
    command: true,
    units: true,
  },

  commandInput: "",
  commandHistory: [],
  historyIndex: -1,

  minimapZoom: 1,
  minimapCenter: { x: 0, y: 0 },

  isBoxSelecting: false,
  boxSelectStart: null,
  boxSelectEnd: null,

  activeModal: null,
  modalData: null,

  togglePanel: (panel) => {
    set((state) => ({
      panelVisibility: {
        ...state.panelVisibility,
        [panel]: !state.panelVisibility[panel],
      },
    }));
  },

  setCommandInput: (input) => {
    set({ commandInput: input, historyIndex: -1 });
  },

  addToHistory: (command) => {
    set((state) => ({
      commandHistory: [...state.commandHistory, command].slice(-100),
      commandInput: "",
      historyIndex: -1,
    }));
  },

  navigateHistory: (direction) => {
    set((state) => {
      const { commandHistory, historyIndex } = state;
      if (commandHistory.length === 0) return state;

      let newIndex: number;
      if (direction === "up") {
        newIndex =
          historyIndex === -1
            ? commandHistory.length - 1
            : Math.max(0, historyIndex - 1);
      } else {
        newIndex =
          historyIndex === -1
            ? -1
            : historyIndex >= commandHistory.length - 1
              ? -1
              : historyIndex + 1;
      }

      return {
        historyIndex: newIndex,
        commandInput:
          newIndex === -1 ? "" : commandHistory[newIndex],
      };
    });
  },

  setMinimapZoom: (zoom) => {
    set({ minimapZoom: Math.max(0.5, Math.min(3, zoom)) });
  },

  setMinimapCenter: (center) => {
    set({ minimapCenter: center });
  },

  startBoxSelect: (point) => {
    set({ isBoxSelecting: true, boxSelectStart: point, boxSelectEnd: point });
  },

  updateBoxSelect: (point) => {
    set({ boxSelectEnd: point });
  },

  endBoxSelect: () => {
    set({ isBoxSelecting: false, boxSelectStart: null, boxSelectEnd: null });
  },

  openModal: (modalId, data) => {
    set({ activeModal: modalId, modalData: data ?? null });
  },

  closeModal: () => {
    set({ activeModal: null, modalData: null });
  },
}));
