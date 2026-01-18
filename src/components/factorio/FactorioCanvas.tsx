import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useUIStore } from "../../stores/uiStore";
import { useAgentStore } from "../../stores/agentStore";
import { useFactoryStore } from "../../stores/factoryStore";
import { useMetricsStore } from "../../stores/metricsStore";
import { useRegistryStore } from "../../stores/registryStore";
import { FactorioRenderer, type Entity, type AgentEntity, type ResourceEntity } from "./FactorioRenderer";
import { screenToWorld, snapToGrid, TILE_SIZE } from "./grid";
import { AgentChatPalette } from "./AgentChatPalette";
import { AgentPicker } from "./AgentPicker";
import type { RegistryAgent } from "../../types/registry";

interface ContextMenu {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
}

interface DraggedEntity {
  entityId: string;
  entityType: "agent" | "resource";
  startGridX: number;
  startGridY: number;
}

interface DragState {
  entities: DraggedEntity[];
  // The primary entity being dragged (for offset calculations)
  primaryEntityId: string;
  primaryStartGridX: number;
  primaryStartGridY: number;
}

interface PendingDrag {
  entityId: string;
  entityType: "agent" | "resource";
  startGridX: number;
  startGridY: number;
  startScreenX: number;
  startScreenY: number;
}

interface SelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

const DRAG_THRESHOLD = 5; // pixels before drag starts

export function FactorioCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FactorioRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasRestoredAgents = useRef(false);
  const hasRestoredViewport = useRef(false);
  const viewportSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [pendingDrag, setPendingDrag] = useState<PendingDrag | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [pendingDeployProjectId, setPendingDeployProjectId] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [respondedInputIds, setRespondedInputIds] = useState<Set<string>>(new Set());

  const viewport = useUIStore((s) => s.factorioViewport);
  const setFactorioViewport = useUIStore((s) => s.setFactorioViewport);
  const panCanvas = useUIStore((s) => s.panFactorioCanvas);
  const zoomCanvas = useUIStore((s) => s.zoomFactorioCanvas);

  const agents = useAgentStore((s) => s.agents);
  const selectedAgentIds = useAgentStore((s) => s.selectedAgentIds);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const setSelectedAgentIds = useAgentStore((s) => s.setSelectedAgentIds);
  const clearSelection = useAgentStore((s) => s.clearSelection);
  const spawnAgent = useAgentStore((s) => s.spawnAgent);
  const stopAgent = useAgentStore((s) => s.stopAgent);

  const projects = useFactoryStore((s) => s.projects);
  const agentPlacements = useFactoryStore((s) => s.agentPlacements);
  const isLoaded = useFactoryStore((s) => s.isLoaded);
  const loadFromBackend = useFactoryStore((s) => s.loadFromBackend);
  const addProject = useFactoryStore((s) => s.addProject);
  const removeProject = useFactoryStore((s) => s.removeProject);
  const moveProject = useFactoryStore((s) => s.moveProject);
  const setAgentPlacement = useFactoryStore((s) => s.setAgentPlacement);
  const removeAgentPlacement = useFactoryStore((s) => s.removeAgentPlacement);
  const getAgentPlacement = useFactoryStore((s) => s.getAgentPlacement);
  const findNextAvailablePosition = useFactoryStore((s) => s.findNextAvailablePosition);
  const getPersistedAgents = useFactoryStore((s) => s.getPersistedAgents);
  const savedViewport = useFactoryStore((s) => s.viewport);
  const saveViewport = useFactoryStore((s) => s.saveViewport);

  // Selected project IDs (local state since projects don't have a store for selection)
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());

  const metrics = useMetricsStore((s) => s.metrics);
  const fetchMetrics = useMetricsStore((s) => s.fetchMetrics);

  const fetchRegistryAgents = useRegistryStore((s) => s.fetchAgents);
  const registryIcons = useRegistryStore((s) => s.icons);

  // Load factory state on mount
  useEffect(() => {
    if (!isLoaded) {
      loadFromBackend();
    }
  }, [isLoaded, loadFromBackend]);

  // Fetch registry agents on mount
  useEffect(() => {
    fetchRegistryAgents();
  }, [fetchRegistryAgents]);

  // Load provider icons into renderer when they become available
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    registryIcons.forEach((dataUrl, providerId) => {
      renderer.loadProviderIcon(providerId, dataUrl);
    });
  }, [registryIcons]);

  // Preload provider sprites for all agents
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Get unique provider IDs from all agents
    const providerIds = new Set<string>();
    agents.forEach((agent) => {
      if (agent.provider_id) {
        providerIds.add(agent.provider_id);
      }
    });

    // Preload sprites for each provider
    providerIds.forEach((providerId) => {
      renderer.preloadProviderSprites(providerId);
    });
  }, [agents]);

  // Restore viewport from saved state
  useEffect(() => {
    if (!isLoaded || hasRestoredViewport.current) return;

    // Apply saved viewport to uiStore
    if (savedViewport.offset_x !== 0 || savedViewport.offset_y !== 0 || savedViewport.zoom !== 1) {
      setFactorioViewport({
        offsetX: savedViewport.offset_x,
        offsetY: savedViewport.offset_y,
        zoom: savedViewport.zoom,
      });
    }
    hasRestoredViewport.current = true;
  }, [isLoaded, savedViewport, setFactorioViewport]);

  // Save viewport when it changes (debounced)
  useEffect(() => {
    if (!isLoaded || !hasRestoredViewport.current) return;

    // Clear previous timeout
    if (viewportSaveTimeout.current) {
      clearTimeout(viewportSaveTimeout.current);
    }

    // Debounce save to avoid too many writes
    viewportSaveTimeout.current = setTimeout(() => {
      saveViewport(viewport.offsetX, viewport.offsetY, viewport.zoom);
    }, 500);

    return () => {
      if (viewportSaveTimeout.current) {
        clearTimeout(viewportSaveTimeout.current);
      }
    };
  }, [isLoaded, viewport.offsetX, viewport.offsetY, viewport.zoom, saveViewport]);

  // Restore persisted agents after factory is loaded
  useEffect(() => {
    if (!isLoaded || hasRestoredAgents.current) return;

    // Mark as restored IMMEDIATELY to prevent re-runs when agents state changes
    hasRestoredAgents.current = true;

    const restoreAgents = async () => {
      const persistedAgents = getPersistedAgents();

      for (const placement of persistedAgents) {
        if (placement.name && placement.working_directory) {
          try {
            console.log(`Restoring agent: ${placement.name} (provider: ${placement.provider_id || 'default'})`);
            const agent = await spawnAgent(placement.name, placement.working_directory, placement.provider_id || undefined);

            // Agent gets a new ID on spawn, update placement
            // Remove old placement and create new one with the new agent ID
            await removeAgentPlacement(placement.agent_id);
            await setAgentPlacement(
              agent.id,
              placement.grid_x,
              placement.grid_y,
              placement.connected_project_id,
              placement.name,
              placement.working_directory,
              placement.provider_id
            );
          } catch (error) {
            console.error(`Failed to restore agent ${placement.name}:`, error);
          }
        }
      }
    };

    restoreAgents();
  }, [isLoaded, getPersistedAgents, spawnAgent, setAgentPlacement, removeAgentPlacement]);

  // Fetch metrics on mount and periodically
  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Delete selected agents handler
  const handleDeleteSelected = useCallback(async () => {
    if (selectedAgentIds.size === 0 && selectedProjectIds.size === 0) return;

    const agentIdsToDelete = Array.from(selectedAgentIds);
    const projectIdsToDelete = Array.from(selectedProjectIds);

    clearSelection();
    setSelectedProjectIds(new Set());

    // Delete agents
    for (const agentId of agentIdsToDelete) {
      try {
        await stopAgent(agentId);
        await removeAgentPlacement(agentId);
      } catch (error) {
        console.error(`Failed to delete agent ${agentId}:`, error);
      }
    }

    // Delete projects
    for (const projectId of projectIdsToDelete) {
      try {
        await removeProject(projectId);
      } catch (error) {
        console.error(`Failed to delete project ${projectId}:`, error);
      }
    }
  }, [selectedAgentIds, selectedProjectIds, clearSelection, stopAgent, removeAgentPlacement, removeProject]);

  // Handle initiating deploy - shows agent picker first
  const handleInitiateDeploy = useCallback((projectId: string) => {
    setPendingDeployProjectId(projectId);
    setShowDeployDialog(false);
    setShowAgentPicker(true);
  }, []);

  // Handle deploying an agent with selected provider
  const handleDeployWithProvider = useCallback(async (registryAgent: RegistryAgent) => {
    if (!pendingDeployProjectId) return;

    const project = projects.get(pendingDeployProjectId);
    if (!project) return;

    setShowAgentPicker(false);
    setIsDeploying(true);
    setDeployError(null);

    try {
      const agentName = `${registryAgent.name}-${project.name}`;
      const agent = await spawnAgent(agentName, project.path, registryAgent.id);

      // Place the agent near the project and persist metadata including provider
      const agentPos = findNextAvailablePosition({ x: project.grid_x, y: project.grid_y });
      setAgentPlacement(agent.id, agentPos.x, agentPos.y, pendingDeployProjectId, agentName, project.path, registryAgent.id);

      // Select the new agent to open its chat window
      setSelectedProjectIds(new Set());
      selectAgent(agent.id, false);
    } catch (error) {
      console.error("Failed to deploy agent:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setDeployError(`Failed to deploy ${registryAgent.name}: ${errorMsg}`);
    } finally {
      setIsDeploying(false);
      setPendingDeployProjectId(null);
    }
  }, [pendingDeployProjectId, projects, spawnAgent, findNextAvailablePosition, setAgentPlacement, selectAgent]);

  // Legacy deploy handler for backward compatibility (uses default Claude)
  const handleDeployAgent = useCallback(async (projectId: string) => {
    handleInitiateDeploy(projectId);
  }, [handleInitiateDeploy]);

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

  // Keyboard handler for delete, select all, and WASD navigation
  useEffect(() => {
    const PAN_SPEED = 20;
    const keysPressed = new Set<string>();
    let animationId: number | null = null;

    const updatePan = () => {
      let dx = 0;
      let dy = 0;

      if (keysPressed.has("w") || keysPressed.has("arrowup")) dy += PAN_SPEED;
      if (keysPressed.has("s") || keysPressed.has("arrowdown")) dy -= PAN_SPEED;
      if (keysPressed.has("a") || keysPressed.has("arrowleft")) dx += PAN_SPEED;
      if (keysPressed.has("d") || keysPressed.has("arrowright")) dx -= PAN_SPEED;

      if (dx !== 0 || dy !== 0) {
        panCanvas(dx, dy);
        animationId = requestAnimationFrame(updatePan);
      } else {
        animationId = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if focus is on an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const key = e.key.toLowerCase();

      // WASD and arrow keys for panning
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        e.preventDefault();
        keysPressed.add(key);
        if (!animationId) {
          animationId = requestAnimationFrame(updatePan);
        }
        return;
      }

      // Delete or Backspace to remove selected agents/projects
      if ((e.key === "Delete" || e.key === "Backspace") && (selectedAgentIds.size > 0 || selectedProjectIds.size > 0)) {
        e.preventDefault();
        handleDeleteSelected();
      }

      // Cmd/Ctrl+A to select all agents and projects
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        const allAgentIds = new Set(agents.keys());
        const allProjectIds = new Set(projects.keys());
        setSelectedAgentIds(allAgentIds);
        setSelectedProjectIds(allProjectIds);
      }

      // Escape to clear selection
      if (e.key === "Escape") {
        clearSelection();
        setSelectedProjectIds(new Set());
        setContextMenu(null);
      }

      // E to deploy agent to selected project
      if (key === "e" && selectedProjectIds.size === 1 && !isDeploying) {
        e.preventDefault();
        const projectId = Array.from(selectedProjectIds)[0];
        handleDeployAgent(projectId);
      }

      // P to add a new project at viewport center
      if (key === "p") {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          const world = screenToWorld(centerX, centerY, viewport);
          handleAddProject(world.x, world.y);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysPressed.delete(key);

      if (keysPressed.size === 0 && animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [selectedAgentIds, selectedProjectIds, handleDeleteSelected, handleDeployAgent, isDeploying, agents, projects, setSelectedAgentIds, clearSelection, panCanvas, viewport, handleAddProject]);

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
      // Calculate size based on file count (2x2 minimum, scales linearly)
      // ~100 files = 2x2, ~500 files = 3x3, ~1000 files = 4x4, ~2000 files = 5x5, etc.
      const fileCount = project.file_count ?? 0;
      const size = Math.max(2, Math.min(8, Math.floor(2 + fileCount / 400)));

      const resourceEntity: ResourceEntity = {
        id: project.id,
        type: "resource",
        gridX: project.grid_x,
        gridY: project.grid_y,
        width: size,
        height: size,
        path: project.path,
        name: project.name,
        fileCount: project.file_count,
        colorIndex: project.color_index,
      };
      entities.push(resourceEntity);
    });

    // Add agent machines with positions from factory store
    agents.forEach((agent) => {
      const placement = getAgentPlacement(agent.id);

      // Skip agents without placement - they will get placed by the deploy handler
      if (!placement) {
        return;
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
    // Combine agent and project selections
    const allSelectedIds = new Set([...selectedAgentIds, ...selectedProjectIds]);
    renderer.setSelectedIds(allSelectedIds);

    // Build connections map from agent placements
    const connections = new Map<string, string>();
    for (const placement of agentPlacements.values()) {
      if (placement.connected_project_id) {
        connections.set(placement.agent_id, placement.connected_project_id);
      }
    }
    renderer.setConnections(connections);

    // Build set of working agent IDs for belt animation
    const workingAgentIds = new Set<string>();
    for (const agent of agents.values()) {
      if (agent.status === "working") {
        workingAgentIds.add(agent.id);
      }
    }
    renderer.setWorkingAgentIds(workingAgentIds);

    // Pass responded input IDs for badge display
    renderer.setRespondedInputIds(respondedInputIds);
  }, [agents, selectedAgentIds, selectedProjectIds, projects, agentPlacements, isLoaded, getAgentPlacement, respondedInputIds]);

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
          const multiSelect = e.ctrlKey || e.metaKey || e.shiftKey;

          if (entity.type === "agent") {
            if (!multiSelect) {
              setSelectedProjectIds(new Set());
            }
            selectAgent(entity.id, multiSelect);
          } else if (entity.type === "resource") {
            if (!multiSelect) {
              clearSelection();
              setSelectedProjectIds(new Set([entity.id]));
            } else {
              setSelectedProjectIds(prev => {
                const newSet = new Set(prev);
                if (newSet.has(entity.id)) {
                  newSet.delete(entity.id);
                } else {
                  newSet.add(entity.id);
                }
                return newSet;
              });
            }
          }
          // Set up pending drag - actual drag starts after threshold
          setPendingDrag({
            entityId: entity.id,
            entityType: entity.type,
            startGridX: entity.gridX,
            startGridY: entity.gridY,
            startScreenX: x,
            startScreenY: y,
          });
        } else {
          // Shift+drag for box selection, otherwise pan
          if (e.shiftKey) {
            // Start box selection
            if (!e.ctrlKey && !e.metaKey) {
              clearSelection();
              setSelectedProjectIds(new Set());
            }
            setSelectionBox({
              startX: x,
              startY: y,
              currentX: x,
              currentY: y,
            });
          } else {
            // Start panning
            if (!e.ctrlKey && !e.metaKey) {
              clearSelection();
              setSelectedProjectIds(new Set());
            }
            setIsPanning(true);
            setPanStart({ x: e.clientX, y: e.clientY });
          }
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
      } else if (selectionBox && canvas) {
        // Update selection box
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setSelectionBox({
          ...selectionBox,
          currentX: x,
          currentY: y,
        });
      } else if (pendingDrag && canvas) {
        // Check if we've moved past the drag threshold
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - pendingDrag.startScreenX;
        const dy = y - pendingDrag.startScreenY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance >= DRAG_THRESHOLD) {
          // Build list of all entities to drag (selected ones + the one being dragged)
          const entitiesToDrag: DraggedEntity[] = [];

          // Add all selected agents
          for (const agentId of selectedAgentIds) {
            const placement = getAgentPlacement(agentId);
            if (placement) {
              entitiesToDrag.push({
                entityId: agentId,
                entityType: "agent",
                startGridX: placement.grid_x,
                startGridY: placement.grid_y,
              });
            }
          }

          // Add all selected projects
          for (const projectId of selectedProjectIds) {
            const project = projects.get(projectId);
            if (project) {
              entitiesToDrag.push({
                entityId: projectId,
                entityType: "resource",
                startGridX: project.grid_x,
                startGridY: project.grid_y,
              });
            }
          }

          // If the dragged entity isn't in the selection, just drag it alone
          const isInSelection = entitiesToDrag.some(e => e.entityId === pendingDrag.entityId);
          if (!isInSelection) {
            entitiesToDrag.length = 0; // Clear selection-based entities
            entitiesToDrag.push({
              entityId: pendingDrag.entityId,
              entityType: pendingDrag.entityType,
              startGridX: pendingDrag.startGridX,
              startGridY: pendingDrag.startGridY,
            });
          }

          // Convert pending drag to actual drag
          setDragState({
            entities: entitiesToDrag,
            primaryEntityId: pendingDrag.entityId,
            primaryStartGridX: pendingDrag.startGridX,
            primaryStartGridY: pendingDrag.startGridY,
          });
          setPendingDrag(null);

          // Immediately update drag preview for all entities
          const world = screenToWorld(x, y, viewport);
          const snapped = snapToGrid(world.x, world.y);
          if (renderer) {
            const offsetX = snapped.x / TILE_SIZE - pendingDrag.startGridX;
            const offsetY = snapped.y / TILE_SIZE - pendingDrag.startGridY;
            for (const entity of entitiesToDrag) {
              renderer.setDragPreview(entity.entityId, entity.startGridX + offsetX, entity.startGridY + offsetY);
            }
          }
        }
      } else if (dragState && canvas) {
        // Update all entity positions while dragging (visual only)
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const world = screenToWorld(x, y, viewport);
        const snapped = snapToGrid(world.x, world.y);

        // Calculate offset from primary entity's start position
        const offsetX = snapped.x / TILE_SIZE - dragState.primaryStartGridX;
        const offsetY = snapped.y / TILE_SIZE - dragState.primaryStartGridY;

        // Update renderer with preview positions for all dragged entities
        if (renderer) {
          for (const entity of dragState.entities) {
            renderer.setDragPreview(
              entity.entityId,
              entity.startGridX + offsetX,
              entity.startGridY + offsetY
            );
          }
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
    [isPanning, panStart, panCanvas, selectionBox, pendingDrag, dragState, viewport, selectedAgentIds, selectedProjectIds, projects, getAgentPlacement]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;

      if (selectionBox) {
        // Finalize box selection - find agents within the box
        const minX = Math.min(selectionBox.startX, selectionBox.currentX);
        const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
        const minY = Math.min(selectionBox.startY, selectionBox.currentY);
        const maxY = Math.max(selectionBox.startY, selectionBox.currentY);

        // Convert screen box to world coordinates
        const worldMin = screenToWorld(minX, minY, viewport);
        const worldMax = screenToWorld(maxX, maxY, viewport);

        // Find agents within the box
        const selected = new Set<string>();
        for (const placement of agentPlacements.values()) {
          const agentCenterX = (placement.grid_x + 1) * TILE_SIZE; // Center of 2x2 agent
          const agentCenterY = (placement.grid_y + 1) * TILE_SIZE;

          if (
            agentCenterX >= worldMin.x &&
            agentCenterX <= worldMax.x &&
            agentCenterY >= worldMin.y &&
            agentCenterY <= worldMax.y
          ) {
            selected.add(placement.agent_id);
          }
        }

        if (selected.size > 0) {
          // Merge with existing selection if Ctrl/Cmd was held
          if (e.ctrlKey || e.metaKey) {
            const merged = new Set(selectedAgentIds);
            selected.forEach((id) => merged.add(id));
            setSelectedAgentIds(merged);
          } else {
            setSelectedAgentIds(selected);
          }
        }

        setSelectionBox(null);
      } else if (dragState && canvas) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const world = screenToWorld(x, y, viewport);
        const snapped = snapToGrid(world.x, world.y);

        // Calculate offset from primary entity's start position
        const offsetX = snapped.x / TILE_SIZE - dragState.primaryStartGridX;
        const offsetY = snapped.y / TILE_SIZE - dragState.primaryStartGridY;

        // Save new positions for all dragged entities
        for (const entity of dragState.entities) {
          const newGridX = entity.startGridX + offsetX;
          const newGridY = entity.startGridY + offsetY;

          if (entity.entityType === "agent") {
            setAgentPlacement(entity.entityId, newGridX, newGridY);
          } else if (entity.entityType === "resource") {
            moveProject(entity.entityId, newGridX, newGridY);
          }
        }

        if (renderer) {
          renderer.clearDragPreview();
        }
      }

      setIsPanning(false);
      setPanStart(null);
      setPendingDrag(null);
      setDragState(null);
    },
    [selectionBox, dragState, viewport, agentPlacements, selectedAgentIds, setSelectedAgentIds, setAgentPlacement, moveProject]
  );

  const handleMouseLeave = useCallback(() => {
    // Cancel selection box without selecting
    setSelectionBox(null);
    setIsPanning(false);
    setPanStart(null);
    setPendingDrag(null);
    setDragState(null);

    const renderer = rendererRef.current;
    if (renderer) {
      renderer.clearDragPreview();
    }
  }, []);

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
    if (selectionBox) return "crosshair";
    if (isPanning) return "grabbing";
    return "grab";
  };

  const formatTokens = (count: number) => {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return count.toString();
  };

  // Get the selected agent when exactly one is selected
  const selectedAgent = useMemo(() => {
    if (selectedAgentIds.size !== 1) return null;
    const agentId = Array.from(selectedAgentIds)[0];
    return agents.get(agentId) ?? null;
  }, [selectedAgentIds, agents]);

  return (
    <div ref={containerRef} className="factorio-canvas">
      <div className="factorio-canvas__header">
        <span className="factorio-canvas__title">ACPTORIO</span>
        <div className="factorio-canvas__stats">
          <span className="factorio-canvas__stat">
            <span className="factorio-canvas__stat-label">Projects</span>
            <span className="factorio-canvas__stat-value">{projects.size}</span>
          </span>
          <span className="factorio-canvas__stat">
            <span className="factorio-canvas__stat-label">Agents</span>
            <span className="factorio-canvas__stat-value">{agents.size}</span>
          </span>
          <span className="factorio-canvas__stat">
            <span className="factorio-canvas__stat-label">Tokens</span>
            <span className="factorio-canvas__stat-value">{formatTokens(metrics.total_tokens)}</span>
          </span>
          <span className="factorio-canvas__stat">
            <span className="factorio-canvas__stat-label">Cost</span>
            <span className="factorio-canvas__stat-value factorio-canvas__stat-value--cost">
              ${metrics.total_cost_dollars.toFixed(2)}
            </span>
          </span>
        </div>
        <div className="factorio-canvas__controls">
          <button
            className="btn btn--primary"
            onClick={() => setShowDeployDialog(true)}
            disabled={projects.size === 0 || isDeploying}
          >
            {isDeploying ? "Deploying..." : "Deploy"}
          </button>
        </div>
      </div>
      <div className="factorio-canvas__content">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
          style={{ width: "100%", height: "100%", cursor: getCursor() }}
        />

        {/* Selection Box */}
        {selectionBox && (
          <div
            className="selection-box"
            style={{
              position: "absolute",
              left: Math.min(selectionBox.startX, selectionBox.currentX),
              top: Math.min(selectionBox.startY, selectionBox.currentY),
              width: Math.abs(selectionBox.currentX - selectionBox.startX),
              height: Math.abs(selectionBox.currentY - selectionBox.startY),
              border: "1px solid #4a9eff",
              backgroundColor: "rgba(74, 158, 255, 0.15)",
              pointerEvents: "none",
            }}
          />
        )}

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
            {(selectedAgentIds.size > 0 || selectedProjectIds.size > 0) && (
              <button
                className="factorio-context-menu__item factorio-context-menu__item--danger"
                onClick={() => {
                  setContextMenu(null);
                  handleDeleteSelected();
                }}
              >
                Delete Selected ({selectedAgentIds.size + selectedProjectIds.size})
              </button>
            )}
          </div>
        )}

        {/* Deploy Dialog */}
        {showDeployDialog && (
          <div className="deploy-dialog-overlay" onClick={() => setShowDeployDialog(false)}>
            <div className="deploy-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="deploy-dialog__header">
                <span className="deploy-dialog__title">Deploy</span>
                <button
                  className="deploy-dialog__close"
                  onClick={() => setShowDeployDialog(false)}
                >
                  ×
                </button>
              </div>
              <div className="deploy-dialog__content">
                {projects.size === 0 ? (
                  <p className="deploy-dialog__empty">
                    No projects available. Right-click on the canvas to add a project first.
                  </p>
                ) : (
                  <ul className="deploy-dialog__list">
                    {Array.from(projects.values()).map((project) => (
                      <li key={project.id}>
                        <button
                          className="deploy-dialog__project"
                          onClick={() => handleDeployAgent(project.id)}
                        >
                          <span className="deploy-dialog__project-name">{project.name}</span>
                          <span className="deploy-dialog__project-path">{project.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Agent Picker */}
        {showAgentPicker && (
          <AgentPicker
            onSelect={handleDeployWithProvider}
            onClose={() => {
              setShowAgentPicker(false);
              setPendingDeployProjectId(null);
            }}
          />
        )}

        {/* Deploy Error Notification */}
        {deployError && (
          <div className="deploy-error-notification">
            <span className="deploy-error-message">{deployError}</span>
            <button
              className="deploy-error-dismiss"
              onClick={() => setDeployError(null)}
            >
              ×
            </button>
          </div>
        )}

        {/* Agent Chat Palette */}
        {selectedAgent && (
          <AgentChatPalette
            agent={selectedAgent}
            onClose={clearSelection}
            respondedInputIds={respondedInputIds}
            onInputResponded={(inputId) => setRespondedInputIds(prev => new Set(prev).add(inputId))}
          />
        )}
      </div>
    </div>
  );
}
