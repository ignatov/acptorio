/**
 * Belt routing system using A* pathfinding.
 * Finds orthogonal paths between entities while avoiding obstacles.
 */

import type { Point } from "./grid";

export type BeltDirection = "horizontal" | "vertical" | "ne" | "nw" | "se" | "sw";

export interface BeltSegment {
  gridX: number;
  gridY: number;
  direction: BeltDirection;
}

export interface BeltPath {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  segments: BeltSegment[];
}

interface GridNode {
  x: number;
  y: number;
  g: number; // Cost from start
  h: number; // Heuristic (estimated cost to goal)
  f: number; // g + h
  parent: GridNode | null;
  direction: "up" | "down" | "left" | "right" | null;
}

interface Obstacle {
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  entityId: string;
}

export class BeltRouter {
  private obstacles: Obstacle[] = [];
  private occupiedTiles: Set<string> = new Set();

  setObstacles(obstacles: Obstacle[]): void {
    this.obstacles = obstacles;
    this.occupiedTiles.clear();

    for (const obs of obstacles) {
      for (let x = obs.gridX; x < obs.gridX + obs.width; x++) {
        for (let y = obs.gridY; y < obs.gridY + obs.height; y++) {
          this.occupiedTiles.add(`${x},${y}`);
        }
      }
    }
  }

  /**
   * Route a belt from source entity to target entity.
   * Returns an array of belt segments forming the path.
   */
  routeBelt(
    fromEntityId: string,
    fromCenter: Point,
    toEntityId: string,
    toCenter: Point
  ): BeltPath | null {
    // Find grid positions for start and end
    // We want to connect to the edge of entities, not their centers
    const startEdge = this.findBestEdgePoint(fromCenter, toCenter, fromEntityId);
    const endEdge = this.findBestEdgePoint(toCenter, fromCenter, toEntityId);

    // Run A* to find path
    const path = this.findPath(startEdge, endEdge, fromEntityId, toEntityId);

    if (!path || path.length < 2) {
      return null;
    }

    // Convert path points to belt segments with proper directions
    const segments = this.pathToSegments(path);

    return {
      id: `${fromEntityId}-${toEntityId}`,
      fromEntityId,
      toEntityId,
      segments,
    };
  }

  private findBestEdgePoint(from: Point, toward: Point, entityId: string): Point {
    // Find the entity
    const entity = this.obstacles.find(o => o.entityId === entityId);
    if (!entity) {
      return { x: Math.floor(from.x), y: Math.floor(from.y) };
    }

    // Calculate center
    const centerX = entity.gridX + entity.width / 2;
    const centerY = entity.gridY + entity.height / 2;

    // Determine which edge to use based on direction to target
    const dx = toward.x - centerX;
    const dy = toward.y - centerY;

    let edgeX: number;
    let edgeY: number;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal preference
      if (dx > 0) {
        edgeX = entity.gridX + entity.width; // Right edge
        edgeY = Math.floor(centerY);
      } else {
        edgeX = entity.gridX - 1; // Left edge
        edgeY = Math.floor(centerY);
      }
    } else {
      // Vertical preference
      if (dy > 0) {
        edgeX = Math.floor(centerX);
        edgeY = entity.gridY + entity.height; // Bottom edge
      } else {
        edgeX = Math.floor(centerX);
        edgeY = entity.gridY - 1; // Top edge
      }
    }

    return { x: edgeX, y: edgeY };
  }

  private findPath(start: Point, end: Point, fromId: string, toId: string): Point[] | null {
    const openSet: GridNode[] = [];
    const closedSet: Set<string> = new Set();

    const startNode: GridNode = {
      x: start.x,
      y: start.y,
      g: 0,
      h: this.heuristic(start, end),
      f: this.heuristic(start, end),
      parent: null,
      direction: null,
    };

    openSet.push(startNode);

    const maxIterations = 1000;
    let iterations = 0;

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // Find node with lowest f score
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!;

      // Check if we reached the goal
      if (current.x === end.x && current.y === end.y) {
        return this.reconstructPath(current);
      }

      closedSet.add(`${current.x},${current.y}`);

      // Check neighbors (4 directions: up, down, left, right)
      const neighbors: Array<{ x: number; y: number; dir: "up" | "down" | "left" | "right" }> = [
        { x: current.x, y: current.y - 1, dir: "up" },
        { x: current.x, y: current.y + 1, dir: "down" },
        { x: current.x - 1, y: current.y, dir: "left" },
        { x: current.x + 1, y: current.y, dir: "right" },
      ];

      for (const neighbor of neighbors) {
        const key = `${neighbor.x},${neighbor.y}`;

        // Skip if in closed set
        if (closedSet.has(key)) continue;

        // Skip if obstacle (but allow start and end entity tiles)
        if (this.isBlocked(neighbor.x, neighbor.y, fromId, toId)) continue;

        // Calculate costs
        let moveCost = 1;
        // Add turn penalty to encourage straight paths
        if (current.direction && current.direction !== neighbor.dir) {
          moveCost += 0.5;
        }

        const g = current.g + moveCost;
        const h = this.heuristic(neighbor, end);
        const f = g + h;

        // Check if already in open set with better score
        const existingIndex = openSet.findIndex(n => n.x === neighbor.x && n.y === neighbor.y);
        if (existingIndex >= 0) {
          if (openSet[existingIndex].g <= g) continue;
          openSet.splice(existingIndex, 1);
        }

        openSet.push({
          x: neighbor.x,
          y: neighbor.y,
          g,
          h,
          f,
          parent: current,
          direction: neighbor.dir,
        });
      }
    }

    // No path found - fallback to simple L-path
    return this.simpleLPath(start, end);
  }

  private heuristic(a: Point, b: Point): number {
    // Manhattan distance
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private isBlocked(x: number, y: number, allowFromId: string, allowToId: string): boolean {
    // Check if this tile belongs to allowed entities
    for (const obs of this.obstacles) {
      if (obs.entityId === allowFromId || obs.entityId === allowToId) continue;

      if (
        x >= obs.gridX &&
        x < obs.gridX + obs.width &&
        y >= obs.gridY &&
        y < obs.gridY + obs.height
      ) {
        return true;
      }
    }

    return false;
  }

  private reconstructPath(node: GridNode): Point[] {
    const path: Point[] = [];
    let current: GridNode | null = node;

    while (current) {
      path.unshift({ x: current.x, y: current.y });
      current = current.parent;
    }

    return path;
  }

  private simpleLPath(start: Point, end: Point): Point[] {
    // Fallback: simple L-shaped path (vertical then horizontal)
    const path: Point[] = [{ x: start.x, y: start.y }];

    // Move vertically first
    const yDir = end.y > start.y ? 1 : -1;
    for (let y = start.y + yDir; y !== end.y; y += yDir) {
      path.push({ x: start.x, y });
    }

    // Then move horizontally
    const xDir = end.x > start.x ? 1 : -1;
    for (let x = start.x; x !== end.x; x += xDir) {
      path.push({ x, y: end.y });
    }

    path.push({ x: end.x, y: end.y });

    return path;
  }

  private pathToSegments(path: Point[]): BeltSegment[] {
    if (path.length < 2) return [];

    const segments: BeltSegment[] = [];

    for (let i = 0; i < path.length; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const next = path[i + 1];

      const direction = this.getSegmentDirection(prev, curr, next);

      segments.push({
        gridX: curr.x,
        gridY: curr.y,
        direction,
      });
    }

    return segments;
  }

  private getSegmentDirection(
    prev: Point | undefined,
    curr: Point,
    next: Point | undefined
  ): BeltDirection {
    // Determine incoming and outgoing directions
    let incoming: "up" | "down" | "left" | "right" | null = null;
    let outgoing: "up" | "down" | "left" | "right" | null = null;

    if (prev) {
      if (prev.x < curr.x) incoming = "left";
      else if (prev.x > curr.x) incoming = "right";
      else if (prev.y < curr.y) incoming = "up";
      else if (prev.y > curr.y) incoming = "down";
    }

    if (next) {
      if (next.x > curr.x) outgoing = "right";
      else if (next.x < curr.x) outgoing = "left";
      else if (next.y > curr.y) outgoing = "down";
      else if (next.y < curr.y) outgoing = "up";
    }

    // Determine segment type based on incoming/outgoing
    if (!incoming && outgoing) {
      // Start of belt
      return outgoing === "left" || outgoing === "right" ? "horizontal" : "vertical";
    }

    if (incoming && !outgoing) {
      // End of belt
      return incoming === "left" || incoming === "right" ? "horizontal" : "vertical";
    }

    if (incoming && outgoing) {
      // Middle segment - check for corner
      if (incoming === outgoing) {
        // Straight - shouldn't happen but handle it
        return incoming === "left" || incoming === "right" ? "horizontal" : "vertical";
      }

      if (
        (incoming === "left" || incoming === "right") &&
        (outgoing === "left" || outgoing === "right")
      ) {
        // Horizontal to horizontal
        return "horizontal";
      }

      if (
        (incoming === "up" || incoming === "down") &&
        (outgoing === "up" || outgoing === "down")
      ) {
        // Vertical to vertical
        return "vertical";
      }

      // It's a corner - determine which one
      // Corner naming based on which edges the belt connects:
      // ne = connects top (north) and right (east) edges
      // nw = connects top (north) and left (west) edges
      // se = connects bottom (south) and right (east) edges
      // sw = connects bottom (south) and left (west) edges

      // ne: opens at top and right - for north↔east flow
      if ((incoming === "up" && outgoing === "right") || (incoming === "right" && outgoing === "up")) {
        return "ne";
      }
      // nw: opens at top and left - for north↔west flow
      if ((incoming === "up" && outgoing === "left") || (incoming === "left" && outgoing === "up")) {
        return "nw";
      }
      // se: opens at bottom and right - for south↔east flow
      if ((incoming === "down" && outgoing === "right") || (incoming === "right" && outgoing === "down")) {
        return "se";
      }
      // sw: opens at bottom and left - for south↔west flow
      if ((incoming === "down" && outgoing === "left") || (incoming === "left" && outgoing === "down")) {
        return "sw";
      }
    }

    // Default fallback
    return "horizontal";
  }
}

// Singleton router instance
let routerInstance: BeltRouter | null = null;

export function getBeltRouter(): BeltRouter {
  if (!routerInstance) {
    routerInstance = new BeltRouter();
  }
  return routerInstance;
}
