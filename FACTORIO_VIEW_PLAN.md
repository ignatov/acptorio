# Factorio-Style Agents View - Implementation Plan

## Overview

Replace the current `UnitPortraits` component with a Factorio-inspired canvas where agents appear as industrial machines processing resources. Project folders are ore patches that agents connect to via animated conveyor belts.

## Visual Concept

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FACTORIO CANVAS (pan/zoom)                      │
│                                                                         │
│    ┌─────────┐                              ┌─────────┐                 │
│    │░░░░░░░░░│  ══════════════════════════▶ │ ⚙️      │                 │
│    │ PROJECT │  (prompts, files, tasks)     │ AGENT-1 │ ═══▶ (outputs)  │
│    │ /src    │  ◀══════════════════════════ │ working │                 │
│    │░░░░░░░░░│                              └─────────┘                 │
│    └─────────┘                                   │                      │
│         │                                        │                      │
│         │      ┌─────────────────────────────────┘                      │
│         │      │                                                        │
│         ▼      ▼                                                        │
│    ┌─────────┐                              ┌─────────┐                 │
│    │░░░░░░░░░│  ══════════════════════════▶ │ ⚙️      │                 │
│    │ PROJECT │                              │ AGENT-2 │ ═══▶            │
│    │ /tests  │  ◀══════════════════════════ │  idle   │                 │
│    │░░░░░░░░░│                              └─────────┘                 │
│    └─────────┘                                                          │
│                                                                         │
│    [Items flowing on belts: 📝 prompts  📄 files  ✅ tasks  📦 outputs] │
└─────────────────────────────────────────────────────────────────────────┘
```

## Requirements Summary

| Aspect | Decision |
|--------|----------|
| View mode | Replaces UnitPortraits entirely |
| Canvas | Full pan/zoom (drag to pan, scroll to zoom) |
| Grid | 64px large tiles |
| Visual style | Factorio-authentic, high fidelity pixel art |
| Assets | Custom PNG sprite sheets |
| Animations | Full - items move on belts, machines animate |
| Agent details | Click to show in CommandPanel |
| Placement | Auto-place on spawn, draggable by user |
| Projects | Resource nodes (ore patches) agents connect to |
| Connections | Belts mapping agents ↔ project folders |
| Inputs | Prompts (blue), files (orange), tasks (green) |
| Outputs | Completed (green), modified files (yellow), logs (gray) |

---

## Phase 1: Canvas Infrastructure

### 1.1 Create FactorioCanvas Component
**File**: `src/components/factorio/FactorioCanvas.tsx`

- HTML5 Canvas element with React refs
- Handles mouse events for pan (drag) and zoom (wheel)
- Renders at device pixel ratio for crisp sprites
- Manages render loop with `requestAnimationFrame`

```typescript
interface CanvasState {
  offsetX: number;      // Pan offset
  offsetY: number;
  zoom: number;         // 0.5 to 2.0
  isDragging: boolean;
}
```

### 1.2 Update UI Store for Viewport
**File**: `src/stores/uiStore.ts`

Add viewport state:
```typescript
interface UIState {
  // ... existing
  factorioViewport: {
    offsetX: number;
    offsetY: number;
    zoom: number;
  };
  setFactorioViewport: (viewport: Partial<FactorioViewport>) => void;
}
```

### 1.3 Grid System
**File**: `src/components/factorio/grid.ts`

- 64px tile size
- World coordinates ↔ screen coordinates transforms
- Snap-to-grid helpers for placement

```typescript
const TILE_SIZE = 64;

function worldToScreen(worldX: number, worldY: number, viewport: Viewport): Point
function screenToWorld(screenX: number, screenY: number, viewport: Viewport): Point
function snapToGrid(worldX: number, worldY: number): Point
```

---

## Phase 2: Core Visual Elements

### 2.1 Agent Machine Component
**File**: `src/components/factorio/AgentMachine.ts`

Represents an agent as a Factorio-style assembling machine:

```typescript
interface AgentMachineState {
  id: string;
  gridX: number;        // Grid position
  gridY: number;
  status: AgentStatus;  // Controls animation frame
  animationFrame: number;
}
```

**Sprite states**:
- `idle` - Machine powered but not working
- `working` - Animated pistons/gears
- `error` - Red warning light
- `paused` - Dimmed/grayed
- `attention` - Yellow flashing (pending input)

**Size**: 2x2 tiles (128x128 pixels)

### 2.2 Resource Node Component
**File**: `src/components/factorio/ResourceNode.ts`

Represents project folders as ore/resource patches:

```typescript
interface ResourceNodeState {
  path: string;         // Project folder path
  gridX: number;
  gridY: number;
  type: 'project';      // Could expand to different resource types
}
```

**Appearance**: Ore patch style, 2x2 tiles
**Label**: Folder name displayed below

### 2.3 Position Storage
**File**: `src/stores/agentStore.ts`

Extend agent state:
```typescript
interface AgentInfo {
  // ... existing fields
  gridPosition: { x: number; y: number } | null;
}
```

Add actions:
```typescript
setAgentPosition: (agentId: string, x: number, y: number) => void;
```

---

## Phase 3: Conveyor Belt System

### 3.1 Belt Component
**File**: `src/components/factorio/ConveyorBelt.ts`

Animated conveyor belts connecting resources ↔ agents:

```typescript
interface BeltSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  direction: 'horizontal' | 'vertical' | 'corner-ne' | 'corner-nw' | 'corner-se' | 'corner-sw';
}

interface Belt {
  id: string;
  segments: BeltSegment[];
  fromEntity: string;   // Resource node or agent ID
  toEntity: string;
  animationOffset: number;  // For smooth scrolling animation
}
```

**Animation**: Belt texture scrolls continuously (4-8 fps sprite animation)

### 3.2 Belt Router
**File**: `src/components/factorio/beltRouter.ts`

Algorithm to create belt paths:
1. Find shortest orthogonal path from source to destination
2. Avoid overlapping existing entities
3. Use corners for direction changes
4. Support multiple belts to same entity

```typescript
function routeBelt(from: Point, to: Point, obstacles: Entity[]): BeltSegment[]
```

### 3.3 Resource Items
**File**: `src/components/factorio/ResourceItem.ts`

Small sprites that flow along belts:

```typescript
interface ResourceItem {
  id: string;
  type: 'prompt' | 'file' | 'task' | 'completed' | 'modified' | 'log';
  beltId: string;
  position: number;     // 0.0 to 1.0 along belt
  speed: number;
}
```

**Colors/Icons**:
- Inputs:
  - `prompt` - Blue circuit chip
  - `file` - Orange gear
  - `task` - Green plate
- Outputs:
  - `completed` - Green checkmark box
  - `modified` - Yellow document
  - `log` - Gray scroll

---

## Phase 4: Sprite Assets

### 4.1 Required Sprites

All sprites at 64px base tile size, with animation frames where needed.

**Directory**: `src/assets/factorio/`

```
factorio/
├── machines/
│   ├── assembler-idle.png        (128x128, single frame)
│   ├── assembler-working.png     (128x128 x 4 frames = 512x128 spritesheet)
│   ├── assembler-error.png       (128x128, single frame)
│   ├── assembler-paused.png      (128x128, single frame)
│   └── assembler-attention.png   (128x128 x 2 frames = 256x128)
├── resources/
│   ├── ore-patch.png             (128x128)
│   └── ore-patch-depleted.png    (128x128, for disconnected)
├── belts/
│   ├── belt-horizontal.png       (64x64 x 4 frames = 256x64)
│   ├── belt-vertical.png         (64x64 x 4 frames)
│   ├── belt-corner-ne.png        (64x64 x 4 frames)
│   ├── belt-corner-nw.png        (64x64 x 4 frames)
│   ├── belt-corner-se.png        (64x64 x 4 frames)
│   └── belt-corner-sw.png        (64x64 x 4 frames)
├── items/
│   ├── item-prompt.png           (16x16)
│   ├── item-file.png             (16x16)
│   ├── item-task.png             (16x16)
│   ├── item-completed.png        (16x16)
│   ├── item-modified.png         (16x16)
│   └── item-log.png              (16x16)
└── ui/
    ├── grid-tile.png             (64x64, subtle grid pattern)
    └── selection-box.png         (variable, selection highlight)
```

### 4.2 Sprite Loading System
**File**: `src/components/factorio/sprites.ts`

```typescript
interface SpriteSheet {
  image: HTMLImageElement;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
}

const sprites: Map<string, SpriteSheet> = new Map();

async function loadSprites(): Promise<void>
function drawSprite(ctx: CanvasRenderingContext2D, name: string, frame: number, x: number, y: number): void
```

---

## Phase 5: Interactions

### 5.1 Drag and Drop
**File**: `src/components/factorio/interactions.ts`

- Click on agent machine to select
- Drag selected machine to reposition
- Snap to grid on release
- Update store with new position

```typescript
interface DragState {
  entityId: string | null;
  entityType: 'agent' | 'resource' | null;
  startGridPos: Point;
  currentGridPos: Point;
}
```

### 5.2 Selection Integration
- Click agent → select in agentStore
- Ctrl+click → multi-select
- Selected agents show highlight border
- CommandPanel shows selected agent details

### 5.3 Context Menu (Future)
- Right-click agent → Stop, Disconnect, etc.
- Right-click resource → Disconnect all

---

## Phase 6: Real-Time Animation Engine

### 6.1 Animation Loop
**File**: `src/components/factorio/animationLoop.ts`

```typescript
class FactorioRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private lastTime: number = 0;

  start(): void {
    requestAnimationFrame(this.tick.bind(this));
  }

  tick(time: number): void {
    const delta = time - this.lastTime;
    this.lastTime = time;

    this.updateAnimations(delta);
    this.render();

    requestAnimationFrame(this.tick.bind(this));
  }

  updateAnimations(delta: number): void {
    // Update belt scroll positions
    // Update machine animation frames
    // Move items along belts
  }

  render(): void {
    // Clear canvas
    // Draw grid
    // Draw resource nodes
    // Draw belts
    // Draw items on belts
    // Draw machines
    // Draw selection highlights
    // Draw UI overlays (labels, status)
  }
}
```

### 6.2 Event Mapping
**File**: `src/components/factorio/eventMapper.ts`

Map agent events to visual effects:

| Event | Visual Effect |
|-------|---------------|
| `send_prompt` | Spawn prompt item on input belt |
| `agent-update` (working) | Machine animation starts |
| `agent-update` (file read) | File item enters machine |
| `agent-update` (file write) | Modified item exits on output belt |
| `agent-update` (task complete) | Completed item exits |
| `agent-update` (idle) | Machine animation stops |
| `pending_input` | Machine attention animation |

---

## Phase 7: Layout Integration

### 7.1 Replace UnitPortraits
**File**: `src/components/layout/RTSLayout.tsx`

```diff
- import { UnitPortraits } from '../units/UnitPortraits';
+ import { FactorioCanvas } from '../factorio/FactorioCanvas';

// In the grid layout, replace:
- <UnitPortraits />
+ <FactorioCanvas />
```

### 7.2 Update CSS Grid
**File**: `src/styles/rts.css`

Adjust grid to give more space to Factorio canvas:

```css
.rts-layout {
  display: grid;
  grid-template-columns: 280px 1fr 320px;
  grid-template-rows: 48px 1fr 240px;  /* Increased bottom row */
  height: 100vh;
}

.factorio-canvas {
  grid-column: 1 / 3;  /* Span minimap and main view columns */
  grid-row: 3;
  background: var(--bg-primary);
  border-top: 2px solid var(--accent-primary);
}
```

### 7.3 Auto-Placement Algorithm
**File**: `src/components/factorio/autoPlace.ts`

When agent spawns without position:
1. Find first empty 2x2 grid area
2. Place near associated project resource if connected
3. Avoid overlapping existing entities

```typescript
function findPlacementPosition(
  existingEntities: Entity[],
  preferNear?: Point
): Point
```

---

## File Structure

```
src/components/factorio/
├── FactorioCanvas.tsx          # Main canvas component
├── FactorioRenderer.ts         # Render loop and drawing
├── grid.ts                     # Grid math utilities
├── sprites.ts                  # Sprite loading and drawing
├── entities/
│   ├── AgentMachine.ts         # Agent machine entity
│   ├── ResourceNode.ts         # Resource patch entity
│   └── Entity.ts               # Base entity interface
├── belts/
│   ├── ConveyorBelt.ts         # Belt rendering
│   ├── BeltRouter.ts           # Path finding for belts
│   └── ResourceItem.ts         # Items on belts
├── interactions/
│   ├── panZoom.ts              # Pan and zoom handling
│   ├── dragDrop.ts             # Entity dragging
│   └── selection.ts            # Click selection
├── eventMapper.ts              # Agent events → visual effects
└── autoPlace.ts                # Auto-placement algorithm

src/assets/factorio/            # All sprite assets (see Phase 4)
```

---

## Implementation Order

1. **Week 1: Foundation**
   - [ ] Create `FactorioCanvas` with pan/zoom
   - [ ] Implement grid system and coordinate transforms
   - [ ] Create placeholder rectangles for agents/resources
   - [ ] Basic drag-and-drop positioning

2. **Week 2: Sprites & Entities**
   - [ ] Design/create sprite assets (or use placeholders)
   - [ ] Implement sprite loading system
   - [ ] Create `AgentMachine` with status-based sprites
   - [ ] Create `ResourceNode` for project folders

3. **Week 3: Conveyor System**
   - [ ] Implement `ConveyorBelt` with animation
   - [ ] Create belt routing algorithm
   - [ ] Add `ResourceItem` flowing on belts
   - [ ] Connect belts between resources and agents

4. **Week 4: Integration & Polish**
   - [ ] Wire up agent events to visual effects
   - [ ] Replace `UnitPortraits` in layout
   - [ ] Selection integration with existing stores
   - [ ] Polish animations and performance

---

## Technical Considerations

### Performance
- Use `requestAnimationFrame` for smooth 60fps
- Batch canvas draw calls
- Only redraw changed regions if needed
- Use offscreen canvas for static elements (grid)

### State Sync
- Agent positions persisted in `agentStore`
- Viewport state in `uiStore`
- Belt connections derived from agent's `working_directory`

### Sprite Creation Options
1. **Commission pixel artist** - Best quality, authentic Factorio feel
2. **AI generation + cleanup** - Use DALL-E/Midjourney, manually refine
3. **Open source assets** - Find compatible CC0 factory sprites
4. **Programmatic** - Generate simple geometric sprites in code

---

## Phase 8: Persistence & Project Management (NEW)

### 8.1 Factory Store
**File**: `src/stores/factoryStore.ts`

Dedicated store for persistent factory map state:

```typescript
interface ProjectNode {
  id: string;
  path: string;
  name: string;
  gridX: number;
  gridY: number;
}

interface AgentPlacement {
  agentId: string;
  gridX: number;
  gridY: number;
  connectedProjectId: string | null;
}

interface FactoryState {
  projects: Map<string, ProjectNode>;
  agentPlacements: Map<string, AgentPlacement>;

  // Actions
  addProject: (path: string, gridX?: number, gridY?: number) => void;
  removeProject: (id: string) => void;
  moveProject: (id: string, gridX: number, gridY: number) => void;

  setAgentPlacement: (agentId: string, gridX: number, gridY: number) => void;
  connectAgentToProject: (agentId: string, projectId: string) => void;
  removeAgentPlacement: (agentId: string) => void;

  // Persistence
  saveToStorage: () => void;
  loadFromStorage: () => void;
}
```

### 8.2 Persistence Strategy

**Storage location**: `~/.agent-commander/factory-layout.json` (via Tauri fs API)

```json
{
  "version": 1,
  "projects": [
    { "id": "proj-1", "path": "/Users/x/project", "name": "project", "gridX": 0, "gridY": 0 }
  ],
  "agentPlacements": [
    { "agentId": "agent-1", "gridX": 4, "gridY": 0, "connectedProjectId": "proj-1" }
  ],
  "viewport": { "offsetX": 0, "offsetY": 0, "zoom": 1 }
}
```

### 8.3 Add Project UI
- Right-click on empty canvas → "Add Project" → folder picker
- Or drag folder from system onto canvas
- Projects persist across sessions

### 8.4 Agent Deployment Flow
1. User clicks "Deploy Agent"
2. If projects exist on map → prompt to select which project
3. Agent appears on canvas near selected project
4. Agent's `working_directory` set to project path
5. Position persisted in factoryStore

### 8.5 Auto-Save
- Save on every position change (debounced)
- Save on project add/remove
- Load on app startup

---

## Questions Resolved

| Question | Answer |
|----------|--------|
| What do connections represent? | Agent ↔ project folder mapping |
| What flows into agents? | Prompts, files, tasks (all types) |
| What flows out? | Completed tasks, modified files, logs |
| Pan/zoom? | Yes, full support |
| Replace or alternative view? | Replace UnitPortraits entirely |
| Placement? | Auto-place, user can drag |
| Projects appearance? | Resource nodes (ore patches) |
| Visual style? | Factorio-authentic pixel art |
| Animation? | Full belt and machine animation |
| Sprite fidelity? | High (32-64px tiles) |
| Grid size? | 64px tiles |
| Agent details? | Side panel (CommandPanel) |
| Asset creation? | Custom sprites |
