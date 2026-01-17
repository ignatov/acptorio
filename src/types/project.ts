export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
  explored: boolean;
}

export interface ProjectTree {
  root: string;
  tree: FileNode;
  total_files: number;
  total_dirs: number;
}

export interface FogState {
  explored_paths: string[];
  total_explored: number;
}

export interface FileEvent {
  kind: "create" | "modify" | "remove" | "rename" | "other";
  paths: string[];
}
