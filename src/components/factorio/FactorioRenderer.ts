import {
  TILE_SIZE,
  worldToScreen,
  screenToWorld,
  getVisibleGridRange,
  type Viewport,
} from "./grid";
import type { AgentInfo } from "../../types";
import { getSpriteManager, getAnimationFrame, type SpriteManager, PALETTE, PROJECT_COLORS } from "./sprites";
import { BeltRouter, type BeltPath } from "./BeltRouter";

// Colors matching Factorio style
const COLORS = {
  // Terrain
  background: PALETTE.terrainBase,
  gridLine: "rgba(0, 0, 0, 0.1)",
  gridLineMajor: "rgba(0, 0, 0, 0.2)",

  // Machine states
  machineIdle: PALETTE.machineBrass,
  machineWorking: PALETTE.machineGlow,
  machineError: PALETTE.machineError,
  machineAttention: "#ffd700",
  machineBorder: PALETTE.machineFrame,
  machineBorderSelected: PALETTE.selectionYellow,
  machineGlow: PALETTE.machineGlow,

  // Resources
  resourceNode: PALETTE.oreCopper,
  resourceBorder: PALETTE.oreCopperLight,

  // Text
  text: "#ffffff",
  textDim: "#c4a158",
  textShadow: "rgba(0, 0, 0, 0.7)",
};

export interface EntityPosition {
  id: string;
  gridX: number;
  gridY: number;
  width: number; // in grid cells
  height: number; // in grid cells
}

export interface AgentEntity extends EntityPosition {
  type: "agent";
  agent: AgentInfo;
}

export interface ResourceEntity extends EntityPosition {
  type: "resource";
  path: string;
  name: string;
  fileCount?: number;
  colorIndex?: number;
}

export type Entity = AgentEntity | ResourceEntity;

export class FactorioRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationFrameId: number | null = null;
  private lastTime: number = 0;
  private animationTime: number = 0;

  private viewport: Viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
  private entities: Map<string, Entity> = new Map();
  private selectedIds: Set<string> = new Set();
  private hoveredId: string | null = null;
  private dragPreview: { entityId: string; gridX: number; gridY: number } | null = null;

  private spriteManager: SpriteManager | null = null;
  private spritesLoading: boolean = false;

  // Connections: agentId -> projectId
  private connections: Map<string, string> = new Map();

  // Belt routing
  private beltRouter: BeltRouter = new BeltRouter();
  private routedBelts: Map<string, BeltPath> = new Map();
  private beltsDirty: boolean = true;

  // Track working agents for belt animation
  private workingAgentIds: Set<string> = new Set();

  // Track responded input IDs to hide badges immediately
  private respondedInputIds: Set<string> = new Set();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;

    // Load sprites asynchronously
    this.loadSprites();
  }

  private async loadSprites(): Promise<void> {
    if (this.spritesLoading) return;
    this.spritesLoading = true;

    try {
      this.spriteManager = await getSpriteManager(TILE_SIZE);
    } catch (error) {
      console.error("Failed to load sprites:", error);
    }
  }

  start(): void {
    if (this.animationFrameId !== null) return;
    this.lastTime = performance.now();
    this.tick(this.lastTime);
  }

  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private tick = (time: number): void => {
    const delta = time - this.lastTime;
    this.lastTime = time;
    this.animationTime += delta;

    this.render();
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  setEntities(entities: Entity[]): void {
    this.entities.clear();
    for (const entity of entities) {
      this.entities.set(entity.id, entity);
    }
    this.beltsDirty = true;
  }

  setSelectedIds(ids: Set<string>): void {
    this.selectedIds = ids;
  }

  setHoveredId(id: string | null): void {
    this.hoveredId = id;
  }

  setConnections(connections: Map<string, string>): void {
    this.connections = connections;
    this.beltsDirty = true;
  }

  setWorkingAgentIds(ids: Set<string>): void {
    this.workingAgentIds = ids;
  }

  setRespondedInputIds(ids: Set<string>): void {
    this.respondedInputIds = ids;
  }

  setDragPreview(entityId: string, gridX: number, gridY: number): void {
    this.dragPreview = { entityId, gridX, gridY };
    this.beltsDirty = true; // Recalculate routes during drag
  }

  clearDragPreview(): void {
    this.dragPreview = null;
    this.beltsDirty = true; // Recalculate routes after drag ends
  }

  getEntityAtScreen(screenX: number, screenY: number): Entity | null {
    const world = screenToWorld(screenX, screenY, this.viewport);

    for (const entity of this.entities.values()) {
      const entityX = entity.gridX * TILE_SIZE;
      const entityY = entity.gridY * TILE_SIZE;
      const entityWidth = entity.width * TILE_SIZE;
      const entityHeight = entity.height * TILE_SIZE;

      if (
        world.x >= entityX &&
        world.x < entityX + entityWidth &&
        world.y >= entityY &&
        world.y < entityY + entityHeight
      ) {
        return entity;
      }
    }
    return null;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  private render(): void {
    const { ctx, canvas } = this;
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    // Clear
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    this.drawGrid(width, height);

    // Draw conveyor belts (before entities so they appear behind)
    this.drawConveyorBelts();

    // Draw entities (with drag preview support)
    for (const entity of this.entities.values()) {
      if (entity.type === "resource") {
        const pos = this.getEntityRenderPosition(entity);
        this.drawResourceNode(entity, pos.gridX, pos.gridY);
      }
    }

    for (const entity of this.entities.values()) {
      if (entity.type === "agent") {
        const pos = this.getEntityRenderPosition(entity);
        this.drawAgentMachine(entity, pos.gridX, pos.gridY);
      }
    }

    // Draw drag ghost
    if (this.dragPreview) {
      this.drawDragGhost();
    }

    // Draw viewport info (debug)
    this.drawDebugInfo(width, height);
  }

  private drawGrid(width: number, height: number): void {
    const { ctx, viewport, spriteManager } = this;
    const range = getVisibleGridRange(width, height, viewport);
    const screenTileSize = TILE_SIZE * viewport.zoom;

    // Draw terrain tiles with position-based variation
    if (spriteManager) {
      ctx.imageSmoothingEnabled = false;
      for (let x = range.minX; x <= range.maxX; x++) {
        for (let y = range.minY; y <= range.maxY; y++) {
          const terrainTile = spriteManager.getTerrainTile(x, y);
          if (terrainTile) {
            const screenPos = worldToScreen(x * TILE_SIZE, y * TILE_SIZE, viewport);
            ctx.drawImage(terrainTile, screenPos.x, screenPos.y, screenTileSize, screenTileSize);
          }
        }
      }
    }

    // Draw subtle grid lines
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;

    for (let x = range.minX; x <= range.maxX; x++) {
      const screenPos = worldToScreen(x * TILE_SIZE, 0, viewport);
      const isMajor = x % 4 === 0;

      ctx.strokeStyle = isMajor ? COLORS.gridLineMajor : COLORS.gridLine;
      ctx.beginPath();
      ctx.moveTo(screenPos.x, 0);
      ctx.lineTo(screenPos.x, height);
      ctx.stroke();
    }

    for (let y = range.minY; y <= range.maxY; y++) {
      const screenPos = worldToScreen(0, y * TILE_SIZE, viewport);
      const isMajor = y % 4 === 0;

      ctx.strokeStyle = isMajor ? COLORS.gridLineMajor : COLORS.gridLine;
      ctx.beginPath();
      ctx.moveTo(0, screenPos.y);
      ctx.lineTo(width, screenPos.y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  private getEntityRenderPosition(entity: Entity): { gridX: number; gridY: number } {
    if (this.dragPreview && this.dragPreview.entityId === entity.id) {
      return { gridX: this.dragPreview.gridX, gridY: this.dragPreview.gridY };
    }
    return { gridX: entity.gridX, gridY: entity.gridY };
  }

  private drawDragGhost(): void {
    if (!this.dragPreview) return;

    const { ctx, viewport } = this;
    const entity = this.entities.get(this.dragPreview.entityId);
    if (!entity) return;

    const screenPos = worldToScreen(
      this.dragPreview.gridX * TILE_SIZE,
      this.dragPreview.gridY * TILE_SIZE,
      viewport
    );
    const screenWidth = entity.width * TILE_SIZE * viewport.zoom;
    const screenHeight = entity.height * TILE_SIZE * viewport.zoom;

    // Draw ghost outline
    ctx.strokeStyle = "rgba(0, 255, 136, 0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(screenPos.x, screenPos.y, screenWidth, screenHeight);
    ctx.setLineDash([]);
  }

  private drawAgentMachine(entity: AgentEntity, gridX: number, gridY: number): void {
    const { ctx, viewport, selectedIds, hoveredId, animationTime, spriteManager, respondedInputIds } = this;
    const { agent, width, height } = entity;

    const screenPos = worldToScreen(gridX * TILE_SIZE, gridY * TILE_SIZE, viewport);
    const screenWidth = width * TILE_SIZE * viewport.zoom;
    const screenHeight = height * TILE_SIZE * viewport.zoom;

    const isSelected = selectedIds.has(entity.id);
    const isHovered = hoveredId === entity.id;
    // Filter out responded inputs for badge display
    const pendingInputs = agent.pending_inputs.filter(p => !respondedInputIds.has(p.id));
    const hasPendingInput = pendingInputs.length > 0;

    // Try to use sprite if available
    const spriteSet = spriteManager?.getSprite("assembler");
    if (spriteSet) {
      // Determine which animation to use
      let animation = spriteSet.idle;
      if (agent.status === "working" && spriteSet.working) {
        animation = spriteSet.working;
      } else if (agent.status === "error" && spriteSet.error) {
        animation = spriteSet.error;
      }

      // Get current frame
      const frame = getAnimationFrame(animation, animationTime);

      // Draw shadow
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(screenPos.x + 4 * viewport.zoom, screenPos.y + 4 * viewport.zoom, screenWidth, screenHeight);

      // Draw sprite
      ctx.imageSmoothingEnabled = false; // Pixel art should be crisp
      ctx.drawImage(frame, screenPos.x, screenPos.y, screenWidth, screenHeight);

      // Draw blinking red overlay when permission is needed (Factorio "no fuel" style)
      if (hasPendingInput) {
        const blinkPhase = Math.sin(animationTime / 300) * 0.5 + 0.5; // 0 to 1, ~1.6Hz blink
        const overlayAlpha = blinkPhase * 0.4; // Max 40% opacity
        ctx.fillStyle = `rgba(255, 60, 60, ${overlayAlpha})`;
        ctx.fillRect(screenPos.x, screenPos.y, screenWidth, screenHeight);
      }

      // Draw selection/hover border (Factorio yellow style)
      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? COLORS.machineBorderSelected : COLORS.machineBorder;
        ctx.lineWidth = isSelected ? 3 : 2;
        // Draw corner brackets instead of full rect (Factorio style)
        const cornerSize = Math.min(screenWidth, screenHeight) * 0.2;
        this.drawSelectionBrackets(ctx, screenPos.x, screenPos.y, screenWidth, screenHeight, cornerSize);
      }
    } else {
      // Fallback to primitive rendering
      let bodyColor = COLORS.machineIdle;
      let borderColor = COLORS.machineBorder;

      if (agent.status === "working") {
        bodyColor = this.pulseColor(COLORS.machineIdle, COLORS.machineWorking, animationTime, 500);
      } else if (agent.status === "error") {
        bodyColor = COLORS.machineError;
      } else if (hasPendingInput) {
        borderColor = this.pulseColor(COLORS.machineBorder, COLORS.machineAttention, animationTime, 800);
      }

      if (isSelected) {
        borderColor = COLORS.machineBorderSelected;
      }

      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(screenPos.x + 4, screenPos.y + 4, screenWidth, screenHeight);

      ctx.fillStyle = bodyColor;
      ctx.fillRect(screenPos.x, screenPos.y, screenWidth, screenHeight);

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = isSelected || isHovered ? 3 : 2;
      ctx.strokeRect(screenPos.x, screenPos.y, screenWidth, screenHeight);

      const padding = 8 * viewport.zoom;
      const innerX = screenPos.x + padding;
      const innerY = screenPos.y + padding;
      const innerW = screenWidth - padding * 2;
      const innerH = screenHeight - padding * 2;

      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(innerX, innerY, innerW, innerH * 0.6);

      const progressBarHeight = 8 * viewport.zoom;
      const progressBarY = screenPos.y + screenHeight - padding - progressBarHeight;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(innerX, progressBarY, innerW, progressBarHeight);

      const progressWidth = (agent.progress / 100) * innerW;
      ctx.fillStyle = agent.status === "error" ? COLORS.machineError : COLORS.machineWorking;
      ctx.fillRect(innerX, progressBarY, progressWidth, progressBarHeight);

      if (agent.status === "working") {
        const gearSize = 16 * viewport.zoom;
        const gearX = screenPos.x + screenWidth / 2;
        const gearY = screenPos.y + innerH * 0.3 + padding;
        const rotation = (animationTime / 500) % (Math.PI * 2);

        ctx.save();
        ctx.translate(gearX, gearY);
        ctx.rotate(rotation);

        ctx.fillStyle = COLORS.machineWorking;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const r = i % 2 === 0 ? gearSize : gearSize * 0.6;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }
    }

    // Agent name (always draw with shadow)
    const nameX = screenPos.x + screenWidth / 2;
    const nameY = screenPos.y + screenHeight + 16 * viewport.zoom;
    ctx.font = `bold ${12 * viewport.zoom}px "JetBrains Mono", monospace`;
    ctx.textAlign = "center";
    // Shadow
    ctx.fillStyle = COLORS.textShadow;
    ctx.fillText(agent.name, nameX + 1, nameY + 1);
    // Text
    ctx.fillStyle = COLORS.text;
    ctx.fillText(agent.name, nameX, nameY);

    // Pending input indicator (always draw)
    if (hasPendingInput) {
      const badgeSize = 20 * viewport.zoom;
      const badgeX = screenPos.x + screenWidth - badgeSize / 2;
      const badgeY = screenPos.y - badgeSize / 2;

      ctx.fillStyle = COLORS.machineAttention;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeSize / 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#000";
      ctx.font = `bold ${12 * viewport.zoom}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(pendingInputs.length), badgeX, badgeY);
    }
  }

  private drawResourceNode(entity: ResourceEntity, gridX: number, gridY: number): void {
    const { ctx, viewport, animationTime, selectedIds, hoveredId } = this;
    const { id, width, height, name, colorIndex, fileCount } = entity;

    const screenPos = worldToScreen(gridX * TILE_SIZE, gridY * TILE_SIZE, viewport);
    const screenWidth = width * TILE_SIZE * viewport.zoom;
    const screenHeight = height * TILE_SIZE * viewport.zoom;

    const isSelected = selectedIds.has(id);
    const isHovered = hoveredId === id;

    // Get color based on colorIndex
    const colors = PROJECT_COLORS[colorIndex !== undefined ? colorIndex % PROJECT_COLORS.length : 0];

    // Draw ore chunks with project-specific color
    const dotSize = 12 * viewport.zoom;
    const spacing = 18 * viewport.zoom;

    // Ore deposit positions (irregular pattern)
    const seed = (gridX * 73856093 + gridY * 19349663) >>> 0;
    const pseudoRandom = (i: number) => {
      const x = Math.sin(seed + i * 127.1) * 43758.5453;
      return x - Math.floor(x);
    };

    let chunkIndex = 0;
    for (let dx = spacing; dx < screenWidth - spacing * 0.5; dx += spacing) {
      for (let dy = spacing; dy < screenHeight - spacing * 0.5; dy += spacing) {
        const shimmer = Math.sin((animationTime / 400 + chunkIndex * 0.7)) * 0.3 + 0.7;
        const offsetX = (pseudoRandom(chunkIndex) - 0.5) * 8 * viewport.zoom;
        const offsetY = (pseudoRandom(chunkIndex + 100) - 0.5) * 8 * viewport.zoom;
        const size = dotSize * (0.7 + pseudoRandom(chunkIndex + 200) * 0.5);

        // Shadow
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.ellipse(
          screenPos.x + dx + offsetX + 2,
          screenPos.y + dy + offsetY + 2,
          size * 0.6, size * 0.4, 0, 0, Math.PI * 2
        );
        ctx.fill();

        // Main chunk with color variation
        const colorVariant = shimmer > 0.8 ? colors.light : shimmer < 0.5 ? colors.dark : colors.main;
        ctx.fillStyle = colorVariant;
        ctx.beginPath();
        ctx.ellipse(
          screenPos.x + dx + offsetX,
          screenPos.y + dy + offsetY,
          size * 0.5, size * 0.35, pseudoRandom(chunkIndex + 300) * Math.PI, 0, Math.PI * 2
        );
        ctx.fill();

        chunkIndex++;
      }
    }

    // Border with project color
    ctx.strokeStyle = colors.light;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(screenPos.x, screenPos.y, screenWidth, screenHeight);
    ctx.setLineDash([]);

    // Draw selection/hover brackets (Factorio yellow style)
    if (isSelected || isHovered) {
      ctx.strokeStyle = isSelected ? COLORS.machineBorderSelected : COLORS.machineBorder;
      ctx.lineWidth = isSelected ? 3 : 2;
      const cornerSize = Math.min(screenWidth, screenHeight) * 0.2;
      this.drawSelectionBrackets(ctx, screenPos.x, screenPos.y, screenWidth, screenHeight, cornerSize);
    }

    // Label with file count
    const labelX = screenPos.x + screenWidth / 2;
    const labelY = screenPos.y + screenHeight + 14 * viewport.zoom;
    ctx.font = `bold ${11 * viewport.zoom}px "JetBrains Mono", monospace`;
    ctx.textAlign = "center";

    const displayName = fileCount !== undefined ? `${name} (${fileCount})` : name;

    // Shadow
    ctx.fillStyle = COLORS.textShadow;
    ctx.fillText(displayName, labelX + 1, labelY + 1);
    // Text
    ctx.fillStyle = COLORS.text;
    ctx.fillText(displayName, labelX, labelY);
  }

  private drawSelectionBrackets(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, cornerSize: number
  ): void {
    ctx.beginPath();
    // Top-left corner
    ctx.moveTo(x, y + cornerSize);
    ctx.lineTo(x, y);
    ctx.lineTo(x + cornerSize, y);
    // Top-right corner
    ctx.moveTo(x + w - cornerSize, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + cornerSize);
    // Bottom-right corner
    ctx.moveTo(x + w, y + h - cornerSize);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - cornerSize, y + h);
    // Bottom-left corner
    ctx.moveTo(x + cornerSize, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + h - cornerSize);
    ctx.stroke();
  }

  private drawDebugInfo(_width: number, height: number): void {
    const { ctx, viewport } = this;

    ctx.fillStyle = COLORS.textDim;
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      `Zoom: ${viewport.zoom.toFixed(2)}x | Offset: (${viewport.offsetX.toFixed(0)}, ${viewport.offsetY.toFixed(0)})`,
      8,
      height - 8
    );
  }

  private updateBeltRoutes(): void {
    if (!this.beltsDirty) return;
    this.beltsDirty = false;

    // Build obstacle list from entities
    const obstacles = Array.from(this.entities.values()).map(entity => ({
      gridX: entity.gridX,
      gridY: entity.gridY,
      width: entity.width,
      height: entity.height,
      entityId: entity.id,
    }));

    this.beltRouter.setObstacles(obstacles);
    this.routedBelts.clear();

    // Route each connection
    for (const [agentId, projectId] of this.connections) {
      const agent = this.entities.get(agentId);
      const project = this.entities.get(projectId);

      if (!agent || !project) continue;

      // Get entity positions (accounting for drag preview)
      const agentPos = this.getEntityRenderPosition(agent);
      const projectPos = this.getEntityRenderPosition(project);

      // Calculate center points in grid coordinates
      const agentCenter = {
        x: agentPos.gridX + agent.width / 2,
        y: agentPos.gridY + agent.height / 2,
      };
      const projectCenter = {
        x: projectPos.gridX + project.width / 2,
        y: projectPos.gridY + project.height / 2,
      };

      // Update obstacles with current drag positions
      const currentObstacles = obstacles.map(obs => {
        if (obs.entityId === agentId) {
          return { ...obs, gridX: agentPos.gridX, gridY: agentPos.gridY };
        }
        if (obs.entityId === projectId) {
          return { ...obs, gridX: projectPos.gridX, gridY: projectPos.gridY };
        }
        return obs;
      });
      this.beltRouter.setObstacles(currentObstacles);

      const path = this.beltRouter.routeBelt(
        projectId,
        projectCenter,
        agentId,
        agentCenter
      );

      if (path) {
        this.routedBelts.set(path.id, path);
      }
    }
  }

  private drawConveyorBelts(): void {
    const { ctx, viewport, animationTime, workingAgentIds } = this;

    // Update routes if needed
    this.updateBeltRoutes();

    const screenTileSize = TILE_SIZE * viewport.zoom;
    ctx.imageSmoothingEnabled = false;

    // Draw each belt path
    for (const beltPath of this.routedBelts.values()) {
      const segments = beltPath.segments;

      if (segments.length === 0) continue;

      // Check if the agent at the end of this belt is working
      const isAgentWorking = workingAgentIds.has(beltPath.toEntityId);
      // Use animation time only if agent is working, otherwise use 0 for static frame
      const effectiveAnimTime = isAgentWorking ? animationTime : 0;

      // Draw each segment
      for (const segment of segments) {
        const sprite = this.getBeltSprite(segment.direction);

        if (sprite) {
          const frame = getAnimationFrame(sprite.idle, effectiveAnimTime);
          const screenPos = worldToScreen(
            segment.gridX * TILE_SIZE,
            segment.gridY * TILE_SIZE,
            viewport
          );
          ctx.drawImage(frame, screenPos.x, screenPos.y, screenTileSize, screenTileSize);
        } else {
          // Fallback: draw colored rectangle
          const screenPos = worldToScreen(
            segment.gridX * TILE_SIZE,
            segment.gridY * TILE_SIZE,
            viewport
          );
          ctx.fillStyle = "#444444";
          ctx.fillRect(screenPos.x + 4, screenPos.y + 4, screenTileSize - 8, screenTileSize - 8);
        }
      }

      // Draw animated item on the belt path only if agent is working
      if (isAgentWorking) {
        this.drawBeltItem(beltPath, animationTime);
      }
    }
  }

  private getBeltSprite(direction: string) {
    const { spriteManager } = this;
    if (!spriteManager) return null;

    switch (direction) {
      case "horizontal":
        return spriteManager.getSprite("belt-h");
      case "vertical":
        return spriteManager.getSprite("belt-v");
      case "ne":
        return spriteManager.getSprite("belt-ne");
      case "nw":
        return spriteManager.getSprite("belt-nw");
      case "se":
        return spriteManager.getSprite("belt-se");
      case "sw":
        return spriteManager.getSprite("belt-sw");
      default:
        return spriteManager.getSprite("belt-h");
    }
  }

  private drawBeltItem(beltPath: BeltPath, animationTime: number): void {
    const { ctx, viewport } = this;
    const segments = beltPath.segments;

    if (segments.length === 0) return;

    // Calculate total path length and item position
    const totalSegments = segments.length;
    const itemProgress = (animationTime / 3000) % 1; // 3 seconds per loop
    const currentSegmentFloat = itemProgress * totalSegments;
    const currentSegmentIndex = Math.min(Math.floor(currentSegmentFloat), totalSegments - 1);
    const segmentProgress = currentSegmentFloat - currentSegmentIndex;

    const segment = segments[currentSegmentIndex];
    const nextSegment = segments[currentSegmentIndex + 1];

    // Interpolate position within segment
    let itemX = segment.gridX + 0.5;
    let itemY = segment.gridY + 0.5;

    if (nextSegment) {
      itemX = segment.gridX + 0.5 + (nextSegment.gridX - segment.gridX) * segmentProgress;
      itemY = segment.gridY + 0.5 + (nextSegment.gridY - segment.gridY) * segmentProgress;
    }

    const screenPos = worldToScreen(itemX * TILE_SIZE, itemY * TILE_SIZE, viewport);
    const itemSize = 8 * viewport.zoom;

    // Draw glowing item
    ctx.fillStyle = COLORS.machineGlow;
    ctx.shadowColor = COLORS.machineGlow;
    ctx.shadowBlur = 10 * viewport.zoom;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, itemSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private pulseColor(color1: string, color2: string, time: number, period: number): string {
    const t = (Math.sin((time / period) * Math.PI * 2) + 1) / 2;
    return this.lerpColor(color1, color2, t);
  }

  private lerpColor(color1: string, color2: string, t: number): string {
    const c1 = this.hexToRgb(color1);
    const c2 = this.hexToRgb(color2);
    if (!c1 || !c2) return color1;

    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);

    return `rgb(${r},${g},${b})`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  }
}
