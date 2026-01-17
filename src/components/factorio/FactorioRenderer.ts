import {
  TILE_SIZE,
  worldToScreen,
  screenToWorld,
  getVisibleGridRange,
  type Viewport,
} from "./grid";
import type { AgentInfo } from "../../types";

// Colors matching the app theme
const COLORS = {
  background: "#1a1a2e",
  gridLine: "#2a2a4e",
  gridLineMajor: "#3a3a5e",
  machineIdle: "#16213e",
  machineWorking: "#00ff88",
  machineError: "#e94560",
  machineAttention: "#ffd700",
  machineBorder: "#4a5568",
  machineBorderSelected: "#e94560",
  resourceNode: "#0f3460",
  resourceBorder: "#00d4ff",
  text: "#f0f0f0",
  textDim: "#718096",
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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx;
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
  }

  setSelectedIds(ids: Set<string>): void {
    this.selectedIds = ids;
  }

  setHoveredId(id: string | null): void {
    this.hoveredId = id;
  }

  setDragPreview(entityId: string, gridX: number, gridY: number): void {
    this.dragPreview = { entityId, gridX, gridY };
  }

  clearDragPreview(): void {
    this.dragPreview = null;
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
    const { ctx, viewport } = this;
    const range = getVisibleGridRange(width, height, viewport);

    ctx.lineWidth = 1;

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
    const { ctx, viewport, selectedIds, hoveredId, animationTime } = this;
    const { agent, width, height } = entity;

    const screenPos = worldToScreen(gridX * TILE_SIZE, gridY * TILE_SIZE, viewport);
    const screenWidth = width * TILE_SIZE * viewport.zoom;
    const screenHeight = height * TILE_SIZE * viewport.zoom;

    const isSelected = selectedIds.has(entity.id);
    const isHovered = hoveredId === entity.id;
    const hasPendingInput = agent.pending_inputs.length > 0;

    // Machine body
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

    // Draw shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(screenPos.x + 4, screenPos.y + 4, screenWidth, screenHeight);

    // Draw body
    ctx.fillStyle = bodyColor;
    ctx.fillRect(screenPos.x, screenPos.y, screenWidth, screenHeight);

    // Draw border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isSelected || isHovered ? 3 : 2;
    ctx.strokeRect(screenPos.x, screenPos.y, screenWidth, screenHeight);

    // Draw inner details (machine look)
    const padding = 8 * viewport.zoom;
    const innerX = screenPos.x + padding;
    const innerY = screenPos.y + padding;
    const innerW = screenWidth - padding * 2;
    const innerH = screenHeight - padding * 2;

    // Inner panel
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(innerX, innerY, innerW, innerH * 0.6);

    // Progress bar at bottom
    const progressBarHeight = 8 * viewport.zoom;
    const progressBarY = screenPos.y + screenHeight - padding - progressBarHeight;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(innerX, progressBarY, innerW, progressBarHeight);

    const progressWidth = (agent.progress / 100) * innerW;
    ctx.fillStyle = agent.status === "error" ? COLORS.machineError : COLORS.machineWorking;
    ctx.fillRect(innerX, progressBarY, progressWidth, progressBarHeight);

    // Agent name
    ctx.fillStyle = COLORS.text;
    ctx.font = `${12 * viewport.zoom}px "JetBrains Mono", monospace`;
    ctx.textAlign = "center";
    ctx.fillText(
      agent.name,
      screenPos.x + screenWidth / 2,
      screenPos.y + screenHeight + 16 * viewport.zoom
    );

    // Status indicator (working animation)
    if (agent.status === "working") {
      const gearSize = 16 * viewport.zoom;
      const gearX = screenPos.x + screenWidth / 2;
      const gearY = screenPos.y + innerH * 0.3 + padding;
      const rotation = (animationTime / 500) % (Math.PI * 2);

      ctx.save();
      ctx.translate(gearX, gearY);
      ctx.rotate(rotation);

      // Simple gear icon
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

    // Pending input indicator
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
      ctx.fillText(String(agent.pending_inputs.length), badgeX, badgeY);
    }
  }

  private drawResourceNode(entity: ResourceEntity, gridX: number, gridY: number): void {
    const { ctx, viewport } = this;
    const { width, height, name } = entity;

    const screenPos = worldToScreen(gridX * TILE_SIZE, gridY * TILE_SIZE, viewport);
    const screenWidth = width * TILE_SIZE * viewport.zoom;
    const screenHeight = height * TILE_SIZE * viewport.zoom;

    // Draw ore patch style
    const oreColor = COLORS.resourceNode;
    const borderColor = COLORS.resourceBorder;

    // Multiple ore dots pattern
    ctx.fillStyle = oreColor;
    const dotSize = 12 * viewport.zoom;
    const spacing = 20 * viewport.zoom;

    for (let dx = spacing; dx < screenWidth - spacing; dx += spacing) {
      for (let dy = spacing; dy < screenHeight - spacing; dy += spacing) {
        const offsetX = (Math.sin(dx * 0.1) * 4) * viewport.zoom;
        const offsetY = (Math.cos(dy * 0.1) * 4) * viewport.zoom;

        ctx.beginPath();
        ctx.arc(
          screenPos.x + dx + offsetX,
          screenPos.y + dy + offsetY,
          dotSize * (0.8 + Math.random() * 0.4),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    // Border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(screenPos.x, screenPos.y, screenWidth, screenHeight);
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = COLORS.text;
    ctx.font = `${11 * viewport.zoom}px "JetBrains Mono", monospace`;
    ctx.textAlign = "center";
    ctx.fillText(
      name,
      screenPos.x + screenWidth / 2,
      screenPos.y + screenHeight + 14 * viewport.zoom
    );
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
