/**
 * Factorio-style pixel art sprite generator and manager.
 * Generates sprites programmatically using canvas primitives.
 * Can be replaced with actual sprite sheets later.
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

// Pixel art color palettes (Factorio-inspired)
const PALETTE = {
  // Assembler machine colors
  machineBase: "#3d4f5f",
  machineDark: "#2a3a44",
  machineLight: "#5a6f7f",
  machineHighlight: "#7a9faf",
  machineAccent: "#ff8844",
  machineGlow: "#00ff88",
  machineError: "#ff4466",

  // Ore patch colors
  oreDark: "#1a3050",
  oreMid: "#2a4a70",
  oreLight: "#4a7ab0",
  oreHighlight: "#6a9ad0",

  // Belt colors
  beltBase: "#444444",
  beltStripe: "#666666",
  beltArrow: "#888888",
};

export class SpriteManager {
  private sprites: Map<string, SpriteSet> = new Map();
  private ready: boolean = false;
  private tileSize: number;

  constructor(tileSize: number = 64) {
    this.tileSize = tileSize;
  }

  async initialize(): Promise<void> {
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

  private async generateAssemblerSprites(): Promise<void> {
    const size = this.tileSize * 2; // 2x2 grid

    // Generate idle frames (subtle animation)
    const idleFrames: ImageBitmap[] = [];
    for (let i = 0; i < 4; i++) {
      const canvas = this.createAssemblerFrame(size, "idle", i);
      idleFrames.push(await createImageBitmap(canvas));
    }

    // Generate working frames (active animation)
    const workingFrames: ImageBitmap[] = [];
    for (let i = 0; i < 8; i++) {
      const canvas = this.createAssemblerFrame(size, "working", i);
      workingFrames.push(await createImageBitmap(canvas));
    }

    // Generate error frames (pulsing)
    const errorFrames: ImageBitmap[] = [];
    for (let i = 0; i < 4; i++) {
      const canvas = this.createAssemblerFrame(size, "error", i);
      errorFrames.push(await createImageBitmap(canvas));
    }

    this.sprites.set("assembler", {
      idle: { frames: idleFrames, frameTime: 500, currentFrame: 0 },
      working: { frames: workingFrames, frameTime: 100, currentFrame: 0 },
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

    const p = size / 32; // Pixel size (32 "pixels" per tile)

    // Base shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    this.drawPixelRect(ctx, 2*p, 2*p, 28*p, 28*p, p);

    // Machine base plate
    ctx.fillStyle = PALETTE.machineDark;
    this.drawPixelRect(ctx, 0, 0, 30*p, 30*p, p);

    // Machine body
    ctx.fillStyle = PALETTE.machineBase;
    this.drawPixelRect(ctx, 2*p, 2*p, 26*p, 26*p, p);

    // Top highlight
    ctx.fillStyle = PALETTE.machineLight;
    this.drawPixelRect(ctx, 2*p, 2*p, 26*p, 4*p, p);

    // Side highlight
    ctx.fillStyle = PALETTE.machineLight;
    this.drawPixelRect(ctx, 2*p, 2*p, 4*p, 26*p, p);

    // Inner panel (dark)
    ctx.fillStyle = PALETTE.machineDark;
    this.drawPixelRect(ctx, 6*p, 6*p, 18*p, 14*p, p);

    // Central mechanism
    const centerX = 15 * p;
    const centerY = 12 * p;
    const gearRadius = 5 * p;

    if (state === "working") {
      // Animated gear
      const rotation = (frameIndex / 8) * Math.PI * 2;
      this.drawPixelGear(ctx, centerX, centerY, gearRadius, rotation, PALETTE.machineGlow, p);

      // Glow effect
      ctx.fillStyle = "rgba(0, 255, 136, 0.3)";
      this.drawPixelRect(ctx, 8*p, 8*p, 14*p, 10*p, p);
    } else if (state === "error") {
      // Pulsing error indicator
      const pulse = Math.sin(frameIndex / 4 * Math.PI) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 68, 102, ${0.3 + pulse * 0.4})`;
      this.drawPixelRect(ctx, 8*p, 8*p, 14*p, 10*p, p);

      // X mark
      ctx.fillStyle = PALETTE.machineError;
      this.drawPixelLine(ctx, 10*p, 9*p, 20*p, 16*p, 2*p);
      this.drawPixelLine(ctx, 20*p, 9*p, 10*p, 16*p, 2*p);
    } else {
      // Idle gear (static with subtle variation)
      const offset = Math.sin(frameIndex / 4 * Math.PI) * 0.5;
      this.drawPixelGear(ctx, centerX, centerY, gearRadius, offset, PALETTE.machineAccent, p);
    }

    // Progress bar area
    ctx.fillStyle = PALETTE.machineDark;
    this.drawPixelRect(ctx, 6*p, 22*p, 18*p, 4*p, p);

    // Progress bar fill (only for working)
    if (state === "working") {
      const progress = (frameIndex / 8);
      ctx.fillStyle = PALETTE.machineGlow;
      this.drawPixelRect(ctx, 7*p, 23*p, Math.floor(16 * progress)*p, 2*p, p);
    }

    // Corner rivets
    ctx.fillStyle = PALETTE.machineHighlight;
    [[4, 4], [26, 4], [4, 26], [26, 26]].forEach(([x, y]) => {
      this.drawPixelRect(ctx, x*p, y*p, 2*p, 2*p, p);
    });

    // Input/output ports
    ctx.fillStyle = PALETTE.machineAccent;
    this.drawPixelRect(ctx, 0, 12*p, 2*p, 6*p, p); // Left input
    this.drawPixelRect(ctx, 28*p, 12*p, 2*p, 6*p, p); // Right output

    return canvas;
  }

  private async generateOreSprites(): Promise<void> {
    const size = this.tileSize * 2;

    // Generate ore patch frames (subtle shimmer)
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

    // Draw ore chunks in a pattern
    const orePositions = [
      [4, 4], [12, 3], [22, 5], [8, 11], [16, 9], [25, 12],
      [3, 18], [10, 20], [18, 17], [26, 21], [6, 26], [14, 25],
      [22, 27], [4, 12], [20, 15], [28, 8]
    ];

    // Background glow
    ctx.fillStyle = "rgba(42, 74, 112, 0.3)";
    this.drawPixelRect(ctx, 0, 0, 30*p, 30*p, p);

    orePositions.forEach(([x, y], i) => {
      // Determine ore chunk size and color based on position
      const shimmer = Math.sin((frameIndex + i) / 4 * Math.PI) * 0.5 + 0.5;
      const colors = [PALETTE.oreDark, PALETTE.oreMid, PALETTE.oreLight, PALETTE.oreHighlight];
      const colorIndex = Math.floor((shimmer + (i % 4) / 4) * colors.length) % colors.length;

      ctx.fillStyle = colors[colorIndex];

      // Draw ore chunk (irregular shape)
      const baseSize = 3 + (i % 3);
      this.drawPixelRect(ctx, x*p, y*p, baseSize*p, baseSize*p, p);

      // Add highlight
      if (shimmer > 0.6) {
        ctx.fillStyle = PALETTE.oreHighlight;
        this.drawPixelRect(ctx, x*p, y*p, p, p, p);
      }
    });

    return canvas;
  }

  private async generateBeltSprites(): Promise<void> {
    const size = this.tileSize;

    // Generate horizontal belt frames
    const hFrames: ImageBitmap[] = [];
    for (let i = 0; i < 8; i++) {
      const canvas = this.createBeltFrame(size, "horizontal", i);
      hFrames.push(await createImageBitmap(canvas));
    }

    this.sprites.set("belt-h", {
      idle: { frames: hFrames, frameTime: 50, currentFrame: 0 },
    });

    // Generate vertical belt frames
    const vFrames: ImageBitmap[] = [];
    for (let i = 0; i < 8; i++) {
      const canvas = this.createBeltFrame(size, "vertical", i);
      vFrames.push(await createImageBitmap(canvas));
    }

    this.sprites.set("belt-v", {
      idle: { frames: vFrames, frameTime: 50, currentFrame: 0 },
    });
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

    const p = size / 16; // 16 pixels per tile

    // Belt base
    ctx.fillStyle = PALETTE.beltBase;
    if (direction === "horizontal") {
      this.drawPixelRect(ctx, 0, 4*p, 16*p, 8*p, p);
    } else {
      this.drawPixelRect(ctx, 4*p, 0, 8*p, 16*p, p);
    }

    // Belt stripes (animated)
    ctx.fillStyle = PALETTE.beltStripe;
    const stripeOffset = frameIndex % 8;

    if (direction === "horizontal") {
      for (let i = -1; i < 5; i++) {
        const x = ((i * 4 + stripeOffset) % 16) * p;
        this.drawPixelRect(ctx, x, 5*p, 2*p, 6*p, p);
      }
      // Side rails
      ctx.fillStyle = PALETTE.machineBase;
      this.drawPixelRect(ctx, 0, 4*p, 16*p, p, p);
      this.drawPixelRect(ctx, 0, 11*p, 16*p, p, p);
    } else {
      for (let i = -1; i < 5; i++) {
        const y = ((i * 4 + stripeOffset) % 16) * p;
        this.drawPixelRect(ctx, 5*p, y, 6*p, 2*p, p);
      }
      // Side rails
      ctx.fillStyle = PALETTE.machineBase;
      this.drawPixelRect(ctx, 4*p, 0, p, 16*p, p);
      this.drawPixelRect(ctx, 11*p, 0, p, 16*p, p);
    }

    return canvas;
  }

  // Pixel art helper methods
  private drawPixelRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    _pixelSize: number
  ): void {
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
  }

  private drawPixelLine(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number, x2: number, y2: number,
    thickness: number
  ): void {
    ctx.lineWidth = thickness;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  private drawPixelGear(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, radius: number,
    rotation: number, color: string, p: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    // Draw gear teeth
    ctx.fillStyle = color;
    const teeth = 6;
    for (let i = 0; i < teeth; i++) {
      const angle = (i / teeth) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      this.drawPixelRect(ctx, x - p, y - p, 2*p, 2*p, p);
    }

    // Center circle
    this.drawPixelRect(ctx, -radius * 0.5, -radius * 0.5, radius, radius, p);

    ctx.restore();
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
