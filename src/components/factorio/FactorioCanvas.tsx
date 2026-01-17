import { useRef, useEffect, useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useUIStore } from "../../stores/uiStore";
import { useAgentStore } from "../../stores/agentStore";
import { useFactoryStore } from "../../stores/factoryStore";
import { FactorioRenderer, type Entity, type AgentEntity, type ResourceEntity } from "./FactorioRenderer";
import { screenToWorld, snapToGrid, TILE_SIZE } from "./grid";

interface ContextMenu {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
}

interface DragState {
  entityId: string;
  entityType: "agent" | "resource";
  startGridX: number;
  startGridY: number;
}

export function FactorioCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FactorioRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const viewport = useUIStore((s) => s.factorioViewport);
  const panCanvas = useUIStore((s) => s.panFactorioCanvas);
  const zoomCanvas = useUIStore((s) => s.zoomFactorioCanvas);

  const agents = useAgentStore((s) => s.agents);
  const selectedAgentIds = useAgentStore((s) => s.selectedAgentIds);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const clearSelection = useAgentStore((s) => s.clearSelection);

  const projects = useFactoryStore((s) => s.projects);
  const agentPlacements = useFactoryStore((s) => s.agentPlacements);
  const isLoaded = useFactoryStore((s) => s.isLoaded);
  const loadFromBackend = useFactoryStore((s) => s.loadFromBackend);
  const addProject = useFactoryStore((s) => s.addProject);
  const moveProject = useFactoryStore((s) => s.moveProject);
  const setAgentPlacement = useFactoryStore((s) => s.setAgentPlacement);
  const getAgentPlacement = useFactoryStore((s) => s.getAgentPlacement);
  const findNextAvailablePosition = useFactoryStore((s) => s.findNextAvailablePosition);

  // Load factory state on mount
  useEffect(() => {
    if (!isLoaded) {
      loadFromBackend();
    }
  }, [isLoaded, loadFromBackend]);

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

  // Update renderer with entities from factory store
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isLoaded) return;

    const entities: Entity[] = [];

    // Add project nodes from factory store
    projects.forEach((project) => {
      const resourceEntity: ResourceEntity = {
        id: project.id,
        type: "resource",
        gridX: project.grid_x,
        gridY: project.grid_y,
        width: 2,
        height: 2,
        path: project.path,
        name: project.name,
      };
      entities.push(resourceEntity);
    });

    // Add agent machines with positions from factory store
    agents.forEach((agent) => {
      let placement = getAgentPlacement(agent.id);

      // If no placement exists, create one
      if (!placement) {
        const pos = findNextAvailablePosition();
        setAgentPlacement(agent.id, pos.x, pos.y);
        placement = { agent_id: agent.id, grid_x: pos.x, grid_y: pos.y, connected_project_id: null };
      }

      const agentEntity: AgentEntity = {
        id: agent.id,
        type: "agent",
        gridX: placement.grid_x,
        gridY: placement.grid_y,
        width: 2,
        height: 2,
        agent,
      };
      entities.push(agentEntity);
    });

    renderer.setEntities(entities);
    renderer.setSelectedIds(selectedAgentIds);
  }, [agents, selectedAgentIds, projects, agentPlacements, isLoaded, getAgentPlacement, findNextAvailablePosition, setAgentPlacement]);

  // Handle adding a project via dialog
  const handleAddProject = useCallback(async (worldX: number, worldY: number) => {
    setContextMenu(null);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Folder",
      });

      if (selected && typeof selected === "string") {
        const snapped = snapToGrid(worldX, worldY);
        addProject(selected, snapped.x / TILE_SIZE, snapped.y / TILE_SIZE);
      }
    } catch (error) {
      console.error("Failed to open folder dialog:", error);
    }
  }, [addProject]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Close context menu on any click
      if (contextMenu) {
        setContextMenu(null);
        return;
      }

      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (!canvas || !renderer) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking on an entity
      const entity = renderer.getEntityAtScreen(x, y);

      if (e.button === 0) { // Left click
        if (entity) {
          if (entity.type === "agent") {
            const multiSelect = e.ctrlKey || e.metaKey;
            selectAgent(entity.id, multiSelect);
          }
          // Start dragging the entity
          setDragState({
            entityId: entity.id,
            entityType: entity.type,
            startGridX: entity.gridX,
            startGridY: entity.gridY,
          });
        } else {
          // Start panning
          if (!e.ctrlKey && !e.metaKey) {
            clearSelection();
          }
          setIsPanning(true);
          setPanStart({ x: e.clientX, y: e.clientY });
        }
      }
    },
    [selectAgent, clearSelection, contextMenu]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;

      if (isPanning && panStart) {
        const deltaX = e.clientX - panStart.x;
        const deltaY = e.clientY - panStart.y;
        panCanvas(deltaX, deltaY);
        setPanStart({ x: e.clientX, y: e.clientY });
      } else if (dragState && canvas) {
        // Update entity position while dragging (visual only)
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const world = screenToWorld(x, y, viewport);
        const snapped = snapToGrid(world.x, world.y);

        // Update renderer with preview position
        if (renderer) {
          renderer.setDragPreview(dragState.entityId, snapped.x / TILE_SIZE, snapped.y / TILE_SIZE);
        }
      } else if (renderer && canvas) {
        // Update hover state
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const entity = renderer.getEntityAtScreen(x, y);
        renderer.setHoveredId(entity?.id ?? null);
      }
    },
    [isPanning, panStart, panCanvas, dragState, viewport]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;

      if (dragState && canvas) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const world = screenToWorld(x, y, viewport);
        const snapped = snapToGrid(world.x, world.y);
        const newGridX = snapped.x / TILE_SIZE;
        const newGridY = snapped.y / TILE_SIZE;

        // Save the new position
        if (dragState.entityType === "agent") {
          setAgentPlacement(dragState.entityId, newGridX, newGridY);
        } else if (dragState.entityType === "resource") {
          moveProject(dragState.entityId, newGridX, newGridY);
        }

        if (renderer) {
          renderer.clearDragPreview();
        }
      }

      setIsPanning(false);
      setPanStart(null);
      setDragState(null);
    },
    [dragState, viewport, setAgentPlacement, moveProject]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const world = screenToWorld(x, y, viewport);

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        worldX: world.x,
        worldY: world.y,
      });
    },
    [viewport]
  );

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

  const getCursor = () => {
    if (dragState) return "grabbing";
    if (isPanning) return "grabbing";
    return "grab";
  };

  return (
    <div ref={containerRef} className="factorio-canvas">
      <div className="factorio-canvas__header">
        <span>FACTORY VIEW</span>
        <span className="factorio-canvas__stats">
          {projects.size} projects | {agents.size} agents | {selectedAgentIds.size} selected
        </span>
      </div>
      <div className="factorio-canvas__content">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
          style={{ width: "100%", height: "100%", cursor: getCursor() }}
        />

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="factorio-context-menu"
            style={{
              position: "fixed",
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            <button
              className="factorio-context-menu__item"
              onClick={() => handleAddProject(contextMenu.worldX, contextMenu.worldY)}
            >
              Add Project
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
