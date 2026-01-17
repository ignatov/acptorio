export const TILE_SIZE = 64;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const ZOOM_SENSITIVITY = 0.001;

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert world coordinates to screen coordinates
 */
export function worldToScreen(worldX: number, worldY: number, viewport: Viewport): Point {
  return {
    x: (worldX - viewport.offsetX) * viewport.zoom,
    y: (worldY - viewport.offsetY) * viewport.zoom,
  };
}

/**
 * Convert screen coordinates to world coordinates
 */
export function screenToWorld(screenX: number, screenY: number, viewport: Viewport): Point {
  return {
    x: screenX / viewport.zoom + viewport.offsetX,
    y: screenY / viewport.zoom + viewport.offsetY,
  };
}

/**
 * Snap a world coordinate to the nearest grid cell
 */
export function snapToGrid(worldX: number, worldY: number): Point {
  return {
    x: Math.round(worldX / TILE_SIZE) * TILE_SIZE,
    y: Math.round(worldY / TILE_SIZE) * TILE_SIZE,
  };
}

/**
 * Get the grid cell coordinates for a world position
 */
export function worldToGrid(worldX: number, worldY: number): Point {
  return {
    x: Math.floor(worldX / TILE_SIZE),
    y: Math.floor(worldY / TILE_SIZE),
  };
}

/**
 * Get the world position for a grid cell
 */
export function gridToWorld(gridX: number, gridY: number): Point {
  return {
    x: gridX * TILE_SIZE,
    y: gridY * TILE_SIZE,
  };
}

/**
 * Clamp zoom level to valid range
 */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * Check if a point is within bounds
 */
export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

/**
 * Check if two bounds intersect
 */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Get visible grid range for current viewport
 */
export function getVisibleGridRange(
  canvasWidth: number,
  canvasHeight: number,
  viewport: Viewport
): { minX: number; maxX: number; minY: number; maxY: number } {
  const topLeft = screenToWorld(0, 0, viewport);
  const bottomRight = screenToWorld(canvasWidth, canvasHeight, viewport);

  return {
    minX: Math.floor(topLeft.x / TILE_SIZE) - 1,
    maxX: Math.ceil(bottomRight.x / TILE_SIZE) + 1,
    minY: Math.floor(topLeft.y / TILE_SIZE) - 1,
    maxY: Math.ceil(bottomRight.y / TILE_SIZE) + 1,
  };
}
