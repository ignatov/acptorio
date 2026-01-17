import { create } from "zustand";

type Panel = "minimap" | "mainview" | "command" | "units";

export interface FactorioViewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

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

  // Factorio Canvas
  factorioViewport: FactorioViewport;

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

  // Factorio viewport actions
  setFactorioViewport: (viewport: Partial<FactorioViewport>) => void;
  panFactorioCanvas: (deltaX: number, deltaY: number) => void;
  zoomFactorioCanvas: (delta: number, centerX: number, centerY: number) => void;
  resetFactorioViewport: () => void;
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

  factorioViewport: {
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
  },

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

  setFactorioViewport: (viewport) => {
    set((state) => ({
      factorioViewport: { ...state.factorioViewport, ...viewport },
    }));
  },

  panFactorioCanvas: (deltaX, deltaY) => {
    set((state) => ({
      factorioViewport: {
        ...state.factorioViewport,
        offsetX: state.factorioViewport.offsetX - deltaX / state.factorioViewport.zoom,
        offsetY: state.factorioViewport.offsetY - deltaY / state.factorioViewport.zoom,
      },
    }));
  },

  zoomFactorioCanvas: (delta, centerX, centerY) => {
    set((state) => {
      const oldZoom = state.factorioViewport.zoom;
      const newZoom = Math.max(0.25, Math.min(2, oldZoom * (1 - delta * 0.001)));

      // Zoom towards cursor position
      const worldX = centerX / oldZoom + state.factorioViewport.offsetX;
      const worldY = centerY / oldZoom + state.factorioViewport.offsetY;
      const newOffsetX = worldX - centerX / newZoom;
      const newOffsetY = worldY - centerY / newZoom;

      return {
        factorioViewport: {
          offsetX: newOffsetX,
          offsetY: newOffsetY,
          zoom: newZoom,
        },
      };
    });
  },

  resetFactorioViewport: () => {
    set({
      factorioViewport: {
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
      },
    });
  },
}));
