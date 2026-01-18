/**
 * Factorio-style pixel art sprite generator and manager.
 * Generates sprites programmatically using canvas primitives.
 * Matches Factorio's industrial aesthetic with earthy browns and brass tones.
 */

export interface SpriteAnimation {
  frames: ImageBitmap[];
  frameTime: number; // ms per frame
  currentFrame: number;
}

export interface SpriteSet {
  idle: SpriteAnimation;
  working?: SpriteAnimation;
  error?: SpriteAnimation;
}

// Factorio-authentic color palette
const PALETTE = {
  // Terrain colors - softer, darker earth tones (easier on eyes)
  terrainBase: "#4a4238",
  terrainDark: "#3d3730",
  terrainMid: "#454035",
  terrainLight: "#524a3f",
  terrainStripe: "#3a352c",
  terrainRock: "#2d2924",

  // Machine colors - industrial brass/bronze
  machineFrame: "#5c5c5c",
  machineFrameLight: "#7a7a7a",
  machineFrameDark: "#3d3d3d",
  machineBrass: "#b8860b",
  machineBrassLight: "#daa520",
  machineBrassDark: "#8b6914",
  machineCopper: "#b87333",
  machinePipe: "#6b6b6b",
  machineGear: "#4a4a4a",
  machineGlow: "#7fff00",
  machineError: "#ff4444",

  // Belt colors - gray metallic with colored indicators
  beltBase: "#5a5a5a",
  beltRail: "#3d3d3d",
  beltRailLight: "#6d6d6d",
  beltArrow: "#8a8a8a",
  beltArrowYellow: "#d4aa00",

  // Ore colors - copper/iron style
  oreCopper: "#b87333",
  oreCopperLight: "#cd853f",
  oreCopperDark: "#8b4513",
  oreIron: "#6b8e9f",
  oreIronLight: "#87ceeb",
  oreIronDark: "#4a6670",

  // UI colors
  selectionYellow: "#ffcc00",
  selectionGlow: "rgba(255, 204, 0, 0.3)",
};

// Different colors for each project (Factorio-style resource colors)
export const PROJECT_COLORS = [
  { main: "#b87333", light: "#cd853f", dark: "#8b4513" }, // Copper
  { main: "#6b8e9f", light: "#87ceeb", dark: "#4a6670" }, // Iron (blue-gray)
  { main: "#4a9f4a", light: "#6fbf6f", dark: "#2d6b2d" }, // Uranium (green)
  { main: "#9f6b9f", light: "#bf8fbf", dark: "#6b4a6b" }, // Purple
  { main: "#9f9f4a", light: "#bfbf6f", dark: "#6b6b2d" }, // Yellow/Gold
  { main: "#4a6b9f", light: "#6f8fbf", dark: "#2d4a6b" }, // Blue
  { main: "#9f4a4a", light: "#bf6f6f", dark: "#6b2d2d" }, // Red
  { main: "#4a9f9f", light: "#6fbfbf", dark: "#2d6b6b" }, // Cyan
];

export class SpriteManager {
  private sprites: Map<string, SpriteSet> = new Map();
  private ready: boolean = false;
  private tileSize: number;
  private terrainTiles: ImageBitmap[] = [];

  constructor(tileSize: number = 64) {
    this.tileSize = tileSize;
  }

  async initialize(): Promise<void> {
    await this.generateTerrainTiles();
    await this.generateAssemblerSprites();
    await this.generateOreSprites();
    await this.generateBeltSprites();
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  getSprite(name: string): SpriteSet | undefined {
    return this.sprites.get(name);
  }

  getTerrainTile(x: number = 0, y: number = 0): ImageBitmap | null {
    if (this.terrainTiles.length === 0) return null;
    // Use position to pick a consistent tile variant
    const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const index = hash % this.terrainTiles.length;
    return this.terrainTiles[index];
  }

  private async generateTerrainTiles(): Promise<void> {
    // Generate multiple terrain tile variants for variety
    const numVariants = 8;

    for (let v = 0; v < numVariants; v++) {
      const canvas = this.createTerrainVariant(v);
      this.terrainTiles.push(await createImageBitmap(canvas));
    }
  }

  private createTerrainVariant(seed: number): HTMLCanvasElement {
    const size = this.tileSize;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // Seeded random for consistent variants
    const random = this.seededRandom(seed * 12345);

    // Base terrain color
    ctx.fillStyle = PALETTE.terrainBase;
    ctx.fillRect(0, 0, size, size);

    const p = size / 16;

    // Very subtle stripes
    ctx.globalAlpha = 0.1;
    const numStripes = 1 + Math.floor(random() * 2);
    for (let i = 0; i < numStripes; i++) {
      const y = random() * size;
      const stripeHeight = (1 + random() * 1.5) * p;

      ctx.fillStyle = PALETTE.terrainDark;
      ctx.fillRect(0, y, size, stripeHeight);
    }

    // Very subtle patches
    ctx.globalAlpha = 0.08;
    const numPatches = 2 + Math.floor(random() * 3);
    for (let i = 0; i < numPatches; i++) {
      const x = random() * size;
      const y = random() * size;
      const s = (2 + random() * 2) * p;
      ctx.fillStyle = random() > 0.5 ? PALETTE.terrainDark : PALETTE.terrainLight;
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * 0.6, random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Minimal noise
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 8; i++) {
      const x = random() * size;
      const y = random() * size;
      const s = (0.5 + random() * 0.5) * p;
      ctx.fillStyle = PALETTE.terrainDark;
      ctx.fillRect(x, y, s, s);
    }

    ctx.globalAlpha = 1;
    return canvas;
  }

  private seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  private async generateAssemblerSprites(): Promise<void> {
    const size = this.tileSize * 2; // 2x2 grid

    // Generate idle frames
    const idleFrames: ImageBitmap[] = [];
    for (let i = 0; i < 4; i++) {
      const canvas = this.createAssemblerFrame(size, "idle", i);
      idleFrames.push(await createImageBitmap(canvas));
    }

    // Generate working frames
    const workingFrames: ImageBitmap[] = [];
    for (let i = 0; i < 8; i++) {
      const canvas = this.createAssemblerFrame(size, "working", i);
      workingFrames.push(await createImageBitmap(canvas));
    }

    // Generate error frames
    const errorFrames: ImageBitmap[] = [];
    for (let i = 0; i < 4; i++) {
      const canvas = this.createAssemblerFrame(size, "error", i);
      errorFrames.push(await createImageBitmap(canvas));
    }

    this.sprites.set("assembler", {
      idle: { frames: idleFrames, frameTime: 500, currentFrame: 0 },
      working: { frames: workingFrames, frameTime: 80, currentFrame: 0 },
      error: { frames: errorFrames, frameTime: 250, currentFrame: 0 },
    });
  }

  private createAssemblerFrame(
    size: number,
    state: "idle" | "working" | "error",
    frameIndex: number
  ): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const p = size / 32; // Pixel size

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    this.roundRect(ctx, 3*p, 3*p, 28*p, 28*p, 2*p);
    ctx.fill();

    // Main machine body - dark frame
    ctx.fillStyle = PALETTE.machineFrame;
    this.roundRect(ctx, 1*p, 1*p, 28*p, 28*p, 2*p);
    ctx.fill();

    // Inner brass panel
    ctx.fillStyle = PALETTE.machineBrass;
    this.roundRect(ctx, 3*p, 3*p, 24*p, 24*p, 1*p);
    ctx.fill();

    // Darker inner section
    ctx.fillStyle = PALETTE.machineBrassDark;
    ctx.fillRect(5*p, 5*p, 20*p, 16*p);

    // Top highlight
    ctx.fillStyle = PALETTE.machineBrassLight;
    ctx.fillRect(3*p, 3*p, 24*p, 2*p);

    // Central mechanism window
    ctx.fillStyle = PALETTE.machineFrameDark;
    ctx.fillRect(8*p, 7*p, 14*p, 10*p);

    // Gear mechanism in center
    const centerX = 15 * p;
    const centerY = 12 * p;

    if (state === "working") {
      const rotation = (frameIndex / 8) * Math.PI * 2;

      // Glowing effect
      ctx.fillStyle = "rgba(127, 255, 0, 0.2)";
      ctx.fillRect(8*p, 7*p, 14*p, 10*p);

      // Animated gear
      this.drawGear(ctx, centerX, centerY, 4*p, rotation, PALETTE.machineGlow);
      this.drawGear(ctx, centerX - 5*p, centerY, 2.5*p, -rotation * 1.5, PALETTE.machineGear);
      this.drawGear(ctx, centerX + 5*p, centerY, 2.5*p, -rotation * 1.5, PALETTE.machineGear);
    } else if (state === "error") {
      const pulse = Math.sin(frameIndex / 2 * Math.PI) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 68, 68, ${0.3 + pulse * 0.4})`;
      ctx.fillRect(8*p, 7*p, 14*p, 10*p);

      // Error X
      ctx.strokeStyle = PALETTE.machineError;
      ctx.lineWidth = 2*p;
      ctx.beginPath();
      ctx.moveTo(10*p, 9*p);
      ctx.lineTo(20*p, 15*p);
      ctx.moveTo(20*p, 9*p);
      ctx.lineTo(10*p, 15*p);
      ctx.stroke();
    } else {
      // Idle - static gears
      this.drawGear(ctx, centerX, centerY, 4*p, 0, PALETTE.machineGear);
      this.drawGear(ctx, centerX - 5*p, centerY, 2.5*p, Math.PI/6, PALETTE.machineGear);
      this.drawGear(ctx, centerX + 5*p, centerY, 2.5*p, Math.PI/6, PALETTE.machineGear);
    }

    // Pipes on sides
    ctx.fillStyle = PALETTE.machinePipe;
    // Left pipe
    ctx.fillRect(0, 12*p, 3*p, 6*p);
    ctx.fillStyle = PALETTE.machineFrameLight;
    ctx.fillRect(0, 12*p, 3*p, 1*p);
    // Right pipe
    ctx.fillStyle = PALETTE.machinePipe;
    ctx.fillRect(27*p, 12*p, 3*p, 6*p);
    ctx.fillStyle = PALETTE.machineFrameLight;
    ctx.fillRect(27*p, 12*p, 3*p, 1*p);

    // Bottom panel with progress
    ctx.fillStyle = PALETTE.machineFrameDark;
    ctx.fillRect(5*p, 22*p, 20*p, 4*p);

    // Progress bar
    if (state === "working") {
      const progress = frameIndex / 8;
      ctx.fillStyle = PALETTE.machineGlow;
      ctx.fillRect(6*p, 23*p, Math.floor(18 * progress)*p, 2*p);
    }

    // Corner bolts
    ctx.fillStyle = PALETTE.machineFrameLight;
    [[4, 4], [26, 4], [4, 26], [26, 26]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x*p, y*p, 1.5*p, 0, Math.PI * 2);
      ctx.fill();
    });

    return canvas;
  }

  private drawGear(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, radius: number,
    rotation: number, color: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    const teeth = 8;
    const innerRadius = radius * 0.6;
    const toothDepth = radius * 0.3;

    ctx.fillStyle = color;
    ctx.beginPath();

    for (let i = 0; i < teeth; i++) {
      const angle1 = (i / teeth) * Math.PI * 2;
      const angle2 = ((i + 0.5) / teeth) * Math.PI * 2;

      const x1 = Math.cos(angle1) * (radius + toothDepth);
      const y1 = Math.sin(angle1) * (radius + toothDepth);
      const x2 = Math.cos(angle2) * radius;
      const y2 = Math.sin(angle2) * radius;

      if (i === 0) {
        ctx.moveTo(x1, y1);
      } else {
        ctx.lineTo(x1, y1);
      }
      ctx.lineTo(x2, y2);
    }
    ctx.closePath();
    ctx.fill();

    // Center hole
    ctx.fillStyle = PALETTE.machineFrameDark;
    ctx.beginPath();
    ctx.arc(0, 0, innerRadius * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private async generateOreSprites(): Promise<void> {
    const size = this.tileSize * 2;

    const frames: ImageBitmap[] = [];
    for (let i = 0; i < 4; i++) {
      const canvas = this.createOreFrame(size, i);
      frames.push(await createImageBitmap(canvas));
    }

    this.sprites.set("ore", {
      idle: { frames, frameTime: 400, currentFrame: 0 },
    });
  }

  private createOreFrame(size: number, frameIndex: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const p = size / 32;

    // Ore deposit positions (irregular pattern)
    const oreChunks = [
      { x: 4, y: 4, s: 5 }, { x: 14, y: 3, s: 6 }, { x: 24, y: 5, s: 4 },
      { x: 8, y: 12, s: 5 }, { x: 18, y: 10, s: 7 }, { x: 26, y: 14, s: 4 },
      { x: 3, y: 20, s: 6 }, { x: 12, y: 22, s: 5 }, { x: 22, y: 19, s: 6 },
      { x: 6, y: 28, s: 4 }, { x: 16, y: 26, s: 5 }, { x: 25, y: 27, s: 4 },
    ];

    // Draw ore chunks with copper coloring
    oreChunks.forEach((chunk, i) => {
      const shimmer = Math.sin((frameIndex + i * 0.7) / 2 * Math.PI) * 0.3 + 0.7;

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse((chunk.x + 1)*p, (chunk.y + 1)*p, chunk.s*p*0.6, chunk.s*p*0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Main ore chunk
      const colors = [PALETTE.oreCopperDark, PALETTE.oreCopper, PALETTE.oreCopperLight];
      const colorIdx = Math.floor((shimmer + i * 0.3) * colors.length) % colors.length;

      ctx.fillStyle = colors[colorIdx];
      ctx.beginPath();
      ctx.ellipse(chunk.x*p, chunk.y*p, chunk.s*p*0.5, chunk.s*p*0.35,
        (i * 0.5) % Math.PI, 0, Math.PI * 2);
      ctx.fill();

      // Highlight
      if (shimmer > 0.8) {
        ctx.fillStyle = PALETTE.oreCopperLight;
        ctx.beginPath();
        ctx.ellipse((chunk.x - 1)*p, (chunk.y - 1)*p, chunk.s*p*0.2, chunk.s*p*0.15, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    return canvas;
  }

  private async generateBeltSprites(): Promise<void> {
    const size = this.tileSize;

    // Horizontal belts
    const hFrames: ImageBitmap[] = [];
    for (let i = 0; i < 8; i++) {
      const canvas = this.createBeltFrame(size, "horizontal", i);
      hFrames.push(await createImageBitmap(canvas));
    }
    this.sprites.set("belt-h", {
      idle: { frames: hFrames, frameTime: 50, currentFrame: 0 },
    });

    // Vertical belts
    const vFrames: ImageBitmap[] = [];
    for (let i = 0; i < 8; i++) {
      const canvas = this.createBeltFrame(size, "vertical", i);
      vFrames.push(await createImageBitmap(canvas));
    }
    this.sprites.set("belt-v", {
      idle: { frames: vFrames, frameTime: 50, currentFrame: 0 },
    });

    // Corner belts
    const corners: Array<"ne" | "nw" | "se" | "sw"> = ["ne", "nw", "se", "sw"];
    for (const corner of corners) {
      const frames: ImageBitmap[] = [];
      for (let i = 0; i < 8; i++) {
        const canvas = this.createCornerBeltFrame(size, corner, i);
        frames.push(await createImageBitmap(canvas));
      }
      this.sprites.set(`belt-${corner}`, {
        idle: { frames, frameTime: 50, currentFrame: 0 },
      });
    }
  }

  private createBeltFrame(
    size: number,
    direction: "horizontal" | "vertical",
    frameIndex: number
  ): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const p = size / 16;
    const offset = frameIndex % 8;

    if (direction === "horizontal") {
      // Belt surface
      ctx.fillStyle = PALETTE.beltBase;
      ctx.fillRect(0, 4*p, 16*p, 8*p);

      // Side rails with metallic look
      ctx.fillStyle = PALETTE.beltRail;
      ctx.fillRect(0, 3*p, 16*p, 2*p);
      ctx.fillRect(0, 11*p, 16*p, 2*p);

      // Rail highlights
      ctx.fillStyle = PALETTE.beltRailLight;
      ctx.fillRect(0, 3*p, 16*p, 1*p);
      ctx.fillRect(0, 11*p, 16*p, 1*p);

      // Chevron arrows (animated)
      ctx.fillStyle = PALETTE.beltArrowYellow;
      for (let i = -1; i < 3; i++) {
        const x = ((i * 6 + offset) % 18) - 2;
        this.drawChevron(ctx, x*p, 8*p, 4*p, "right");
      }
    } else {
      // Belt surface
      ctx.fillStyle = PALETTE.beltBase;
      ctx.fillRect(4*p, 0, 8*p, 16*p);

      // Side rails
      ctx.fillStyle = PALETTE.beltRail;
      ctx.fillRect(3*p, 0, 2*p, 16*p);
      ctx.fillRect(11*p, 0, 2*p, 16*p);

      // Rail highlights
      ctx.fillStyle = PALETTE.beltRailLight;
      ctx.fillRect(3*p, 0, 1*p, 16*p);
      ctx.fillRect(11*p, 0, 1*p, 16*p);

      // Chevron arrows (animated)
      ctx.fillStyle = PALETTE.beltArrowYellow;
      for (let i = -1; i < 3; i++) {
        const y = ((i * 6 + offset) % 18) - 2;
        this.drawChevron(ctx, 8*p, y*p, 4*p, "down");
      }
    }

    return canvas;
  }

  private drawChevron(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    direction: "up" | "down" | "left" | "right"
  ): void {
    ctx.save();
    ctx.translate(x, y);

    const half = size / 2;
    ctx.beginPath();

    switch (direction) {
      case "right":
        ctx.moveTo(-half, -half);
        ctx.lineTo(half, 0);
        ctx.lineTo(-half, half);
        break;
      case "left":
        ctx.moveTo(half, -half);
        ctx.lineTo(-half, 0);
        ctx.lineTo(half, half);
        break;
      case "down":
        ctx.moveTo(-half, -half);
        ctx.lineTo(0, half);
        ctx.lineTo(half, -half);
        break;
      case "up":
        ctx.moveTo(-half, half);
        ctx.lineTo(0, -half);
        ctx.lineTo(half, half);
        break;
    }

    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private createCornerBeltFrame(
    size: number,
    corner: "ne" | "nw" | "se" | "sw",
    frameIndex: number
  ): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const p = size / 16;

    // Draw corner belt base
    ctx.fillStyle = PALETTE.beltBase;

    switch (corner) {
      case "ne": // connects top and right
        ctx.fillRect(4*p, 0, 8*p, 12*p);
        ctx.fillRect(4*p, 4*p, 12*p, 8*p);
        break;
      case "nw": // connects top and left
        ctx.fillRect(4*p, 0, 8*p, 12*p);
        ctx.fillRect(0, 4*p, 12*p, 8*p);
        break;
      case "se": // connects bottom and right
        ctx.fillRect(4*p, 4*p, 8*p, 12*p);
        ctx.fillRect(4*p, 4*p, 12*p, 8*p);
        break;
      case "sw": // connects bottom and left
        ctx.fillRect(4*p, 4*p, 8*p, 12*p);
        ctx.fillRect(0, 4*p, 12*p, 8*p);
        break;
    }

    // Rails
    ctx.fillStyle = PALETTE.beltRail;
    switch (corner) {
      case "ne":
        ctx.fillRect(3*p, 0, 2*p, 12*p);
        ctx.fillRect(11*p, 0, 2*p, 5*p);
        ctx.fillRect(12*p, 3*p, 4*p, 2*p);
        ctx.fillRect(12*p, 11*p, 4*p, 2*p);
        ctx.fillRect(3*p, 11*p, 2*p, 2*p);
        break;
      case "nw":
        ctx.fillRect(11*p, 0, 2*p, 12*p);
        ctx.fillRect(3*p, 0, 2*p, 5*p);
        ctx.fillRect(0, 3*p, 4*p, 2*p);
        ctx.fillRect(0, 11*p, 4*p, 2*p);
        ctx.fillRect(11*p, 11*p, 2*p, 2*p);
        break;
      case "se":
        ctx.fillRect(3*p, 4*p, 2*p, 12*p);
        ctx.fillRect(11*p, 11*p, 2*p, 5*p);
        ctx.fillRect(12*p, 3*p, 4*p, 2*p);
        ctx.fillRect(12*p, 11*p, 4*p, 2*p);
        ctx.fillRect(3*p, 3*p, 2*p, 2*p);
        break;
      case "sw":
        ctx.fillRect(11*p, 4*p, 2*p, 12*p);
        ctx.fillRect(3*p, 11*p, 2*p, 5*p);
        ctx.fillRect(0, 3*p, 4*p, 2*p);
        ctx.fillRect(0, 11*p, 4*p, 2*p);
        ctx.fillRect(11*p, 3*p, 2*p, 2*p);
        break;
    }

    // Rail highlights
    ctx.fillStyle = PALETTE.beltRailLight;
    switch (corner) {
      case "ne":
        ctx.fillRect(3*p, 0, 1*p, 12*p);
        ctx.fillRect(12*p, 3*p, 4*p, 1*p);
        break;
      case "nw":
        ctx.fillRect(12*p, 0, 1*p, 12*p);
        ctx.fillRect(0, 3*p, 4*p, 1*p);
        break;
      case "se":
        ctx.fillRect(3*p, 4*p, 1*p, 12*p);
        ctx.fillRect(12*p, 3*p, 4*p, 1*p);
        break;
      case "sw":
        ctx.fillRect(12*p, 4*p, 1*p, 12*p);
        ctx.fillRect(0, 3*p, 4*p, 1*p);
        break;
    }

    // Animated chevrons on corner
    ctx.fillStyle = PALETTE.beltArrowYellow;
    const offset = frameIndex % 8;

    // Draw chevrons along the corner path
    this.drawCornerChevrons(ctx, corner, offset, p);

    return canvas;
  }

  private drawCornerChevrons(
    ctx: CanvasRenderingContext2D,
    corner: "ne" | "nw" | "se" | "sw",
    offset: number,
    p: number
  ): void {
    const positions = [0, 6, 12].map(pos => (pos + offset) % 16);

    for (const pos of positions) {
      switch (corner) {
        case "ne":
          if (pos < 8) {
            this.drawChevron(ctx, 8*p, (pos + 2)*p, 3*p, "down");
          } else {
            this.drawChevron(ctx, (pos - 2)*p, 8*p, 3*p, "right");
          }
          break;
        case "nw":
          if (pos < 8) {
            this.drawChevron(ctx, 8*p, (pos + 2)*p, 3*p, "down");
          } else {
            this.drawChevron(ctx, (14 - pos)*p, 8*p, 3*p, "left");
          }
          break;
        case "se":
          if (pos < 8) {
            this.drawChevron(ctx, 8*p, (14 - pos)*p, 3*p, "up");
          } else {
            this.drawChevron(ctx, (pos - 2)*p, 8*p, 3*p, "right");
          }
          break;
        case "sw":
          if (pos < 8) {
            this.drawChevron(ctx, 8*p, (14 - pos)*p, 3*p, "up");
          } else {
            this.drawChevron(ctx, (14 - pos)*p, 8*p, 3*p, "left");
          }
          break;
      }
    }
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

// Singleton instance
let spriteManager: SpriteManager | null = null;

export async function getSpriteManager(tileSize: number = 64): Promise<SpriteManager> {
  if (!spriteManager || !spriteManager.isReady()) {
    spriteManager = new SpriteManager(tileSize);
    await spriteManager.initialize();
  }
  return spriteManager;
}

// Animation helper
export function getAnimationFrame(animation: SpriteAnimation, time: number): ImageBitmap {
  const totalFrames = animation.frames.length;
  const frameIndex = Math.floor(time / animation.frameTime) % totalFrames;
  return animation.frames[frameIndex];
}

// Export palette for use in renderer
export { PALETTE };
