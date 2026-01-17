import { useProjectStore } from "../../stores";
import { FileTree } from "./FileTree";

export function Minimap() {
  const { projectTree, exploredPaths } = useProjectStore();

  const exploredCount = exploredPaths.size;
  const totalFiles = projectTree?.total_files ?? 0;

  return (
    <aside className="minimap">
      <div className="minimap__header">
        <span>Map</span>
        <span className="minimap__stats">
          {exploredCount}/{totalFiles} explored
        </span>
      </div>
      <div className="minimap__content">
        {projectTree ? (
          <FileTree node={projectTree.tree} depth={0} />
        ) : (
          <div className="empty-state">
            <div className="empty-state__icon">📁</div>
            <div className="empty-state__title">No Project Loaded</div>
            <div className="empty-state__text">
              Open a project folder to begin
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
