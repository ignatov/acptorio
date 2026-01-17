import { useRef, useEffect, useCallback, useState } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useAgentStore } from "../../stores/agentStore";
import { FactorioRenderer, type Entity, type AgentEntity, type ResourceEntity } from "./FactorioRenderer";

export function FactorioCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FactorioRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  const viewport = useUIStore((s) => s.factorioViewport);
  const panCanvas = useUIStore((s) => s.panFactorioCanvas);
  const zoomCanvas = useUIStore((s) => s.zoomFactorioCanvas);

  const agents = useAgentStore((s) => s.agents);
  const selectedAgentIds = useAgentStore((s) => s.selectedAgentIds);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const clearSelection = useAgentStore((s) => s.clearSelection);

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new FactorioRenderer(canvas);
    rendererRef.current = renderer;

    const handleResize = () => {
      renderer.resize();
    };

    handleResize();
    renderer.start();

    window.addEventListener("resize", handleResize);

    return () => {
      renderer.stop();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Update renderer with viewport
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.setViewport(viewport);
    }
  }, [viewport]);

  // Update renderer with entities
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const entities: Entity[] = [];

    // Create resource nodes from unique working directories
    const workingDirs = new Set<string>();
    agents.forEach((agent) => {
      if (agent.working_directory) {
        workingDirs.add(agent.working_directory);
      }
    });

    let resourceIndex = 0;
    const dirToPosition = new Map<string, { x: number; y: number }>();

    workingDirs.forEach((dir) => {
      const gridX = -4; // Resources on the left
      const gridY = resourceIndex * 4;
      dirToPosition.set(dir, { x: gridX, y: gridY });

      const name = dir.split("/").pop() || dir;
      const resourceEntity: ResourceEntity = {
        id: `resource-${dir}`,
        type: "resource",
        gridX,
        gridY,
        width: 2,
        height: 2,
        path: dir,
        name,
      };
      entities.push(resourceEntity);
      resourceIndex++;
    });

    // Create agent machines
    let agentIndex = 0;
    agents.forEach((agent) => {
      const gridX = 3; // Agents on the right
      const gridY = agentIndex * 4;

      const agentEntity: AgentEntity = {
        id: agent.id,
        type: "agent",
        gridX,
        gridY,
        width: 2,
        height: 2,
        agent,
      };
      entities.push(agentEntity);
      agentIndex++;
    });

    renderer.setEntities(entities);
    renderer.setSelectedIds(selectedAgentIds);
  }, [agents, selectedAgentIds]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (!canvas || !renderer) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking on an entity
      const entity = renderer.getEntityAtScreen(x, y);

      if (entity && entity.type === "agent") {
        // Select the agent
        const multiSelect = e.ctrlKey || e.metaKey;
        selectAgent(entity.id, multiSelect);
      } else if (!entity) {
        // Start panning or clear selection
        if (!e.ctrlKey && !e.metaKey) {
          clearSelection();
        }
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    },
    [selectAgent, clearSelection]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const renderer = rendererRef.current;

      if (isDragging && dragStart) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;
        panCanvas(deltaX, deltaY);
        setDragStart({ x: e.clientX, y: e.clientY });
      } else if (renderer) {
        // Update hover state
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const entity = renderer.getEntityAtScreen(x, y);
          renderer.setHoveredId(entity?.id ?? null);
        }
      }
    },
    [isDragging, dragStart, panCanvas]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      zoomCanvas(e.deltaY, x, y);
    },
    [zoomCanvas]
  );

  return (
    <div ref={containerRef} className="factorio-canvas">
      <div className="factorio-canvas__header">
        <span>FACTORY VIEW</span>
        <span className="factorio-canvas__stats">
          {agents.size} agents | {selectedAgentIds.size} selected
        </span>
      </div>
      <div className="factorio-canvas__content">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ width: "100%", height: "100%", cursor: isDragging ? "grabbing" : "grab" }}
        />
      </div>
    </div>
  );
}
