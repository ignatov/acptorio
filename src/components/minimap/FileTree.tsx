import { useProjectStore } from "../../stores";
import type { FileNode } from "../../types";

interface FileTreeProps {
  node: FileNode;
  depth: number;
}

export function FileTree({ node, depth }: FileTreeProps) {
  const {
    selectedFile,
    setSelectedFile,
    exploredPaths,
    expandedDirs,
    toggleDir,
  } = useProjectStore();

  const isExplored = exploredPaths.has(node.path);
  const isSelected = selectedFile === node.path;
  const isExpanded = expandedDirs.has(node.path);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.is_dir) {
      toggleDir(node.path);
    } else {
      setSelectedFile(node.path);
    }
  };

  const getIcon = () => {
    if (node.is_dir) {
      return isExpanded ? "📂" : "📁";
    }

    const ext = node.name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return "🔷";
      case "js":
      case "jsx":
        return "🟨";
      case "rs":
        return "🦀";
      case "json":
        return "📋";
      case "css":
        return "🎨";
      case "md":
        return "📝";
      case "toml":
        return "⚙️";
      default:
        return "📄";
    }
  };

  return (
    <div className="file-tree">
      <div
        className={`file-tree__item ${isSelected ? "file-tree__item--selected" : ""} ${!isExplored && !node.is_dir ? "file-tree__item--dimmed" : ""}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={handleClick}
      >
        <span className="file-tree__icon">{getIcon()}</span>
        <span className="file-tree__name">{node.name}</span>
      </div>

      {node.is_dir && isExpanded && node.children && (
        <div className="file-tree__children">
          {node.children.map((child) => (
            <FileTree key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
