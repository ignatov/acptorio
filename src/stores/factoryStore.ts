import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface ProjectNode {
  id: string;
  path: string;
  name: string;
  grid_x: number;
  grid_y: number;
  file_count?: number;
  color_index?: number;
}

export interface AgentPlacement {
  agent_id: string;
  grid_x: number;
  grid_y: number;
  connected_project_id: string | null;
  // Persisted agent metadata for restore on startup
  name?: string | null;
  working_directory?: string | null;
  provider_id?: string | null;
}

export interface FactoryViewport {
  offset_x: number;
  offset_y: number;
  zoom: number;
}

export interface FactoryLayout {
  version: number;
  projects: ProjectNode[];
  agent_placements: AgentPlacement[];
  viewport: FactoryViewport;
}

interface FactoryState {
  projects: Map<string, ProjectNode>;
  agentPlacements: Map<string, AgentPlacement>;
  viewport: FactoryViewport;
  isLoaded: boolean;
  nextColorIndex: number;

  // Project actions
  addProject: (path: string, gridX?: number, gridY?: number) => Promise<ProjectNode>;
  removeProject: (id: string) => Promise<void>;
  moveProject: (id: string, gridX: number, gridY: number) => Promise<void>;
  getProjectByPath: (path: string) => ProjectNode | undefined;
  fetchFileCount: (projectId: string) => Promise<void>;

  // Agent placement actions
  setAgentPlacement: (agentId: string, gridX: number, gridY: number, connectedProjectId?: string | null, name?: string | null, workingDirectory?: string | null, providerId?: string | null) => Promise<void>;
  removeAgentPlacement: (agentId: string) => Promise<void>;
  getAgentPlacement: (agentId: string) => AgentPlacement | undefined;

  // Auto-placement helpers
  findNextAvailablePosition: (preferNear?: { x: number; y: number }) => { x: number; y: number };

  // Persistence
  loadFromBackend: () => Promise<void>;
  getPersistedAgents: () => AgentPlacement[];
  saveViewport: (offsetX: number, offsetY: number, zoom: number) => Promise<void>;
  getViewport: () => FactoryViewport;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getNameFromPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function updateFromLayout(layout: FactoryLayout): {
  projects: Map<string, ProjectNode>;
  agentPlacements: Map<string, AgentPlacement>;
  viewport: FactoryViewport;
} {
  const projects = new Map<string, ProjectNode>();
  for (const project of layout.projects) {
    projects.set(project.id, project);
  }

  const agentPlacements = new Map<string, AgentPlacement>();
  for (const placement of layout.agent_placements) {
    agentPlacements.set(placement.agent_id, placement);
  }

  return { projects, agentPlacements, viewport: layout.viewport };
}

export const useFactoryStore = create<FactoryState>((set, get) => ({
  projects: new Map(),
  agentPlacements: new Map(),
  viewport: { offset_x: 0, offset_y: 0, zoom: 1 },
  isLoaded: false,
  nextColorIndex: 0,

  addProject: async (path, gridX, gridY) => {
    const { projects, findNextAvailablePosition, nextColorIndex } = get();

    // Check if project already exists
    for (const project of projects.values()) {
      if (project.path === path) {
        return project;
      }
    }

    const position = gridX !== undefined && gridY !== undefined
      ? { x: gridX, y: gridY }
      : findNextAvailablePosition();

    const id = generateId();
    const name = getNameFromPath(path);
    const colorIndex = nextColorIndex;

    try {
      const layout = await invoke<FactoryLayout>("add_factory_project", {
        id,
        path,
        name,
        gridX: position.x,
        gridY: position.y,
        colorIndex,
      });

      const updated = updateFromLayout(layout);
      set({
        projects: updated.projects,
        agentPlacements: updated.agentPlacements,
        nextColorIndex: nextColorIndex + 1,
      });

      // Fetch file count asynchronously (don't block)
      get().fetchFileCount(id);

      return updated.projects.get(id)!;
    } catch (error) {
      console.error("Failed to add project:", error);
      throw error;
    }
  },

  removeProject: async (id) => {
    try {
      const layout = await invoke<FactoryLayout>("remove_factory_project", {
        projectId: id,
      });

      const updated = updateFromLayout(layout);
      set({ projects: updated.projects, agentPlacements: updated.agentPlacements });
    } catch (error) {
      console.error("Failed to remove project:", error);
      throw error;
    }
  },

  moveProject: async (id, gridX, gridY) => {
    try {
      const layout = await invoke<FactoryLayout>("move_factory_project", {
        projectId: id,
        gridX,
        gridY,
      });

      const updated = updateFromLayout(layout);
      set({ projects: updated.projects, agentPlacements: updated.agentPlacements });
    } catch (error) {
      console.error("Failed to move project:", error);
      throw error;
    }
  },

  getProjectByPath: (path) => {
    const { projects } = get();
    for (const project of projects.values()) {
      if (project.path === path) {
        return project;
      }
    }
    return undefined;
  },

  fetchFileCount: async (projectId) => {
    const { projects } = get();
    const project = projects.get(projectId);
    if (!project) return;

    try {
      const fileCount = await invoke<number>("count_files", { path: project.path });
      const layout = await invoke<FactoryLayout>("update_factory_project", {
        projectId,
        fileCount,
        colorIndex: null,
      });

      const updated = updateFromLayout(layout);
      set({ projects: updated.projects, agentPlacements: updated.agentPlacements });
    } catch (error) {
      console.error("Failed to fetch file count:", error);
    }
  },

  setAgentPlacement: async (agentId, gridX, gridY, connectedProjectId = null, name = null, workingDirectory = null, providerId = null) => {
    try {
      const layout = await invoke<FactoryLayout>("set_agent_placement", {
        agentId,
        gridX,
        gridY,
        connectedProjectId,
        name,
        workingDirectory,
        providerId,
      });

      const updated = updateFromLayout(layout);
      set({ projects: updated.projects, agentPlacements: updated.agentPlacements });
    } catch (error) {
      console.error("Failed to set agent placement:", error);
      throw error;
    }
  },

  removeAgentPlacement: async (agentId) => {
    try {
      const layout = await invoke<FactoryLayout>("remove_agent_placement", {
        agentId,
      });

      const updated = updateFromLayout(layout);
      set({ projects: updated.projects, agentPlacements: updated.agentPlacements });
    } catch (error) {
      console.error("Failed to remove agent placement:", error);
      throw error;
    }
  },

  getAgentPlacement: (agentId) => {
    return get().agentPlacements.get(agentId);
  },

  findNextAvailablePosition: (preferNear) => {
    const { projects, agentPlacements } = get();

    // Calculate project size based on file count (same formula as FactorioCanvas)
    const getProjectSize = (fileCount: number | undefined | null): number => {
      const count = fileCount ?? 0;
      return Math.max(2, Math.min(8, Math.floor(2 + count / 400)));
    };

    // Collect all occupied positions
    const occupied = new Set<string>();
    for (const project of projects.values()) {
      const size = getProjectSize(project.file_count);
      for (let dx = 0; dx < size; dx++) {
        for (let dy = 0; dy < size; dy++) {
          occupied.add(`${project.grid_x + dx},${project.grid_y + dy}`);
        }
      }
    }
    for (const placement of agentPlacements.values()) {
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 2; dy++) {
          occupied.add(`${placement.grid_x + dx},${placement.grid_y + dy}`);
        }
      }
    }

    // Check if a 2x2 area is free
    const isFree = (x: number, y: number): boolean => {
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 2; dy++) {
          if (occupied.has(`${x + dx},${y + dy}`)) {
            return false;
          }
        }
      }
      return true;
    };

    // If preferNear is provided, place agent adjacent to the project
    if (preferNear) {
      // Find the project at this position to get its actual size
      let projectSize = 2;
      for (const project of projects.values()) {
        if (project.grid_x === preferNear.x && project.grid_y === preferNear.y) {
          projectSize = getProjectSize(project.file_count);
          break;
        }
      }

      // Try positions around the project (right, above, left, below)
      // Add spacing of 4 cells for conveyor belts
      const spacing = 4;
      const candidatePositions = [
        { x: preferNear.x + projectSize + spacing, y: preferNear.y },
        { x: preferNear.x, y: preferNear.y - spacing - 2 },
        { x: preferNear.x - spacing - 2, y: preferNear.y },
        { x: preferNear.x, y: preferNear.y + projectSize + spacing },
      ];

      for (const pos of candidatePositions) {
        if (isFree(pos.x, pos.y)) {
          return pos;
        }
      }

      // Expand search in rings around project
      for (let ring = 1; ring <= 10; ring++) {
        const offset = spacing + ring * 4;
        const ringPositions = [
          { x: preferNear.x + projectSize + offset, y: preferNear.y },
          { x: preferNear.x, y: preferNear.y - offset - 2 },
          { x: preferNear.x - offset - 2, y: preferNear.y },
          { x: preferNear.x, y: preferNear.y + projectSize + offset },
        ];
        for (const pos of ringPositions) {
          if (isFree(pos.x, pos.y)) {
            return pos;
          }
        }
      }
    }

    // Default: find first free position in a grid pattern
    for (let y = 0; y < 100; y += 4) {
      for (let x = 0; x < 100; x += 4) {
        if (isFree(x, y)) {
          return { x, y };
        }
      }
    }

    return { x: 0, y: 0 };
  },

  loadFromBackend: async () => {
    try {
      const layout = await invoke<FactoryLayout>("get_factory_layout");

      const updated = updateFromLayout(layout);

      // Calculate next color index from existing projects
      let maxColorIndex = -1;
      for (const project of updated.projects.values()) {
        if (project.color_index !== undefined && project.color_index > maxColorIndex) {
          maxColorIndex = project.color_index;
        }
      }

      set({
        projects: updated.projects,
        agentPlacements: updated.agentPlacements,
        viewport: updated.viewport,
        isLoaded: true,
        nextColorIndex: maxColorIndex + 1,
      });

      // Fetch file counts for projects that don't have them
      for (const project of updated.projects.values()) {
        if (project.file_count === undefined || project.file_count === null) {
          get().fetchFileCount(project.id);
        }
      }
    } catch (error) {
      console.error("Failed to load factory layout:", error);
      set({ isLoaded: true });
    }
  },

  getPersistedAgents: () => {
    const { agentPlacements } = get();
    // Return placements that have persisted agent metadata
    return Array.from(agentPlacements.values()).filter(
      (p) => p.name && p.working_directory
    );
  },

  saveViewport: async (offsetX, offsetY, zoom) => {
    try {
      await invoke<FactoryLayout>("set_factory_viewport", {
        offsetX,
        offsetY,
        zoom,
      });
      set({ viewport: { offset_x: offsetX, offset_y: offsetY, zoom } });
    } catch (error) {
      console.error("Failed to save viewport:", error);
    }
  },

  getViewport: () => {
    return get().viewport;
  },
}));
