import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectTree, FogState, FileNode } from "../types";

// Helper to find a node in the tree by path
function findNode(node: FileNode, path: string): FileNode | null {
  if (node.path === path) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, path);
      if (found) return found;
    }
  }
  return null;
}

// Helper to add a file to the tree at the appropriate location
function addFileToTree(tree: FileNode, filePath: string): FileNode {
  // Check if file already exists
  if (findNode(tree, filePath)) {
    return tree;
  }

  // Get the parent directory path
  const parts = filePath.split("/");
  const fileName = parts.pop() || "";
  const parentPath = parts.join("/");

  // Deep clone the tree to maintain immutability
  const newTree = JSON.parse(JSON.stringify(tree)) as FileNode;

  // Find parent directory
  const parent = findNode(newTree, parentPath);
  if (parent && parent.is_dir) {
    if (!parent.children) {
      parent.children = [];
    }
    // Add new file node
    const newNode: FileNode = {
      name: fileName,
      path: filePath,
      is_dir: false,
      explored: true,
    };
    parent.children.push(newNode);
    // Sort children alphabetically, directories first
    parent.children.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return newTree;
}

// Helper to remove a file from the tree
function removeFileFromTree(tree: FileNode, filePath: string): FileNode {
  // Deep clone the tree to maintain immutability
  const newTree = JSON.parse(JSON.stringify(tree)) as FileNode;

  // Get the parent directory path
  const parts = filePath.split("/");
  parts.pop(); // Remove filename
  const parentPath = parts.join("/");

  // Find parent directory and remove the child
  const parent = findNode(newTree, parentPath);
  if (parent && parent.children) {
    parent.children = parent.children.filter((child) => child.path !== filePath);
  }

  return newTree;
}

const RECENT_PROJECTS_KEY = "agent-commander-recent-projects";
const LAST_PROJECT_KEY = "agent-commander-last-project";
const MAX_RECENT_PROJECTS = 10;

interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

interface ProjectState {
  projectTree: ProjectTree | null;
  projectPath: string | null;
  selectedFile: string | null;
  exploredPaths: Set<string>;
  expandedDirs: Set<string>;
  isLoading: boolean;
  error: string | null;
  recentProjects: RecentProject[];

  // Actions
  setProjectTree: (tree: ProjectTree) => void;
  setSelectedFile: (path: string | null) => void;
  revealPath: (path: string) => void;
  revealPaths: (paths: string[]) => void;
  toggleDir: (path: string) => void;
  expandDir: (path: string) => void;
  collapseDir: (path: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  loadRecentProjects: () => void;
  addRecentProject: (path: string) => void;
  removeRecentProject: (path: string) => void;

  // File watcher actions
  addFile: (path: string) => void;
  removeFile: (path: string) => void;

  // Async actions
  loadProject: (path: string) => Promise<void>;
  loadLastProject: () => Promise<boolean>;
  refreshProject: () => Promise<void>;
  fetchFogState: () => Promise<void>;
}

function loadRecentProjectsFromStorage(): RecentProject[] {
  try {
    const stored = localStorage.getItem(RECENT_PROJECTS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Failed to load recent projects:", e);
  }
  return [];
}

function saveRecentProjectsToStorage(projects: RecentProject[]) {
  try {
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(projects));
  } catch (e) {
    console.error("Failed to save recent projects:", e);
  }
}

function getLastProjectPath(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch (e) {
    console.error("Failed to get last project:", e);
    return null;
  }
}

function saveLastProjectPath(path: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, path);
  } catch (e) {
    console.error("Failed to save last project:", e);
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectTree: null,
  projectPath: null,
  selectedFile: null,
  exploredPaths: new Set(),
  expandedDirs: new Set(),
  isLoading: false,
  error: null,
  recentProjects: loadRecentProjectsFromStorage(),

  setProjectTree: (tree) => {
    set({
      projectTree: tree,
      projectPath: tree.root,
      expandedDirs: new Set([tree.root]),
    });
  },

  setSelectedFile: (path) => {
    set({ selectedFile: path });
    if (path) {
      get().revealPath(path);
    }
  },

  revealPath: (path) => {
    set((state) => {
      const exploredPaths = new Set(state.exploredPaths);
      exploredPaths.add(path);

      // If the file doesn't exist in the tree, add it
      let projectTree = state.projectTree;
      if (projectTree && !findNode(projectTree.tree, path)) {
        const newTree = addFileToTree(projectTree.tree, path);
        projectTree = { ...projectTree, tree: newTree };
      }

      return { exploredPaths, projectTree };
    });
  },

  revealPaths: (paths) => {
    set((state) => {
      const exploredPaths = new Set(state.exploredPaths);
      paths.forEach((p) => exploredPaths.add(p));

      // Add any new files to the tree
      let projectTree = state.projectTree;
      if (projectTree) {
        let tree = projectTree.tree;
        for (const path of paths) {
          if (!findNode(tree, path)) {
            tree = addFileToTree(tree, path);
          }
        }
        if (tree !== projectTree.tree) {
          projectTree = { ...projectTree, tree };
        }
      }

      return { exploredPaths, projectTree };
    });
  },

  toggleDir: (path) => {
    set((state) => {
      const expandedDirs = new Set(state.expandedDirs);
      if (expandedDirs.has(path)) {
        expandedDirs.delete(path);
      } else {
        expandedDirs.add(path);
      }
      return { expandedDirs };
    });
  },

  expandDir: (path) => {
    set((state) => {
      const expandedDirs = new Set(state.expandedDirs);
      expandedDirs.add(path);
      return { expandedDirs };
    });
  },

  collapseDir: (path) => {
    set((state) => {
      const expandedDirs = new Set(state.expandedDirs);
      expandedDirs.delete(path);
      return { expandedDirs };
    });
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  loadRecentProjects: () => {
    set({ recentProjects: loadRecentProjectsFromStorage() });
  },

  addRecentProject: (path) => {
    const name = path.split("/").pop() || path;
    const newProject: RecentProject = {
      path,
      name,
      lastOpened: Date.now(),
    };

    set((state) => {
      // Remove existing entry for this path
      const filtered = state.recentProjects.filter((p) => p.path !== path);
      // Add new entry at the beginning
      const updated = [newProject, ...filtered].slice(0, MAX_RECENT_PROJECTS);
      saveRecentProjectsToStorage(updated);
      return { recentProjects: updated };
    });
  },

  removeRecentProject: (path) => {
    set((state) => {
      const updated = state.recentProjects.filter((p) => p.path !== path);
      saveRecentProjectsToStorage(updated);
      return { recentProjects: updated };
    });
  },

  addFile: (path) => {
    set((state) => {
      if (!state.projectTree) return state;
      const newTree = addFileToTree(state.projectTree.tree, path);
      if (newTree === state.projectTree.tree) return state;
      return {
        projectTree: { ...state.projectTree, tree: newTree },
        exploredPaths: new Set([...state.exploredPaths, path]),
      };
    });
  },

  removeFile: (path) => {
    set((state) => {
      if (!state.projectTree) return state;
      const newTree = removeFileFromTree(state.projectTree.tree, path);
      const exploredPaths = new Set(state.exploredPaths);
      exploredPaths.delete(path);
      return {
        projectTree: { ...state.projectTree, tree: newTree },
        exploredPaths,
      };
    });
  },

  loadProject: async (path) => {
    console.log("Loading project:", path);
    set({ isLoading: true, error: null });
    try {
      const tree = await invoke<ProjectTree>("scan_project", { path });
      console.log("Project loaded:", tree.root);
      set({
        projectTree: tree,
        projectPath: tree.root,
        expandedDirs: new Set([tree.root]),
        exploredPaths: new Set(),
        isLoading: false,
      });
      // Add to recent projects and save as last project
      get().addRecentProject(path);
      saveLastProjectPath(path);
    } catch (e) {
      console.error("Failed to load project:", e);
      set({ error: String(e), isLoading: false });
      throw e;
    }
  },

  loadLastProject: async () => {
    const lastPath = getLastProjectPath();
    if (lastPath) {
      try {
        await get().loadProject(lastPath);
        return true;
      } catch (e) {
        console.error("Failed to load last project:", e);
        return false;
      }
    }
    return false;
  },

  refreshProject: async () => {
    const { projectPath } = get();
    if (projectPath) {
      await get().loadProject(projectPath);
    }
  },

  fetchFogState: async () => {
    try {
      const fog = await invoke<FogState>("get_fog_state");
      set({ exploredPaths: new Set(fog.explored_paths) });
    } catch (e) {
      console.error("Failed to fetch fog state:", e);
    }
  },
}));
