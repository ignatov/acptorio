# acptorio - Architecture

A Factorio-inspired desktop application for orchestrating AI coding agents via the Agent Client Protocol (ACP). Visualize your AI agents as factory machines processing code from project resource patches, connected by animated conveyor belts.

## Overview

acptorio reimagines AI agent orchestration as a factory automation game. Projects appear as ore patches (resource nodes), agents as assembling machines, and the flow of prompts/files/tasks as items on conveyor belts. This creates an intuitive, visual way to manage multiple AI coding agents working across different projects.

## Tech Stack

- **Backend**: Tauri 2.0 (Rust)
- **Frontend**: React + TypeScript + Vite
- **Rendering**: HTML5 Canvas with custom pixel art sprites
- **State Management**: Zustand
- **Agent Protocol**: ACP (Agent Client Protocol) via `@zed-industries/claude-code-acp`

## Visual Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ACPTORIO                    PROJECTS 4  AGENTS 3  TOKENS 125K  COST $2.50  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    ┌─────────┐                              ┌─────────┐                     │
│    │░░░░░░░░░│  ►►►►►►►►►►►►►►►►►►►►►►►►►►► │ ⚙️      │                     │
│    │ PROJECT │  (conveyor belt animation)   │ AGENT-1 │                     │
│    │ /myapp  │                              │ working │ ←── blinking if     │
│    │░░░░░░░░░│                              └─────────┘     needs permission│
│    └─────────┘                                                              │
│     (copper)                                     │                          │
│      2x2-8x8                                     │                          │
│    (by file count)                              ▼                           │
│                                            ┌─────────┐      ┌───────────┐   │
│    ┌─────────┐                             │ ⚙️      │      │Agent Chat │   │
│    │▓▓▓▓▓▓▓▓▓│  ►►►►►►►►►►►►►►►►►►►►►►►►►►►│ AGENT-2 │      │ Palette   │   │
│    │ PROJECT │                             │  idle   │      │           │   │
│    │ /tests  │                             └─────────┘      │ [Approve] │   │
│    │▓▓▓▓▓▓▓▓▓│                                              │ [Deny]    │   │
│    └─────────┘                                              └───────────┘   │
│     (iron)                                                                  │
│                                                                             │
│  [Zoom: 1.0x | Offset: (0, 0)]                              [Deploy]        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
acptorio/
├── src/                              # React Frontend
│   ├── App.tsx                       # Main application component
│   ├── main.tsx                      # Entry point
│   ├── types/
│   │   └── index.ts                  # TypeScript type definitions
│   ├── components/
│   │   └── factorio/                 # Factorio-style canvas system
│   │       ├── FactorioCanvas.tsx    # Main canvas component (pan/zoom/selection)
│   │       ├── FactorioRenderer.ts   # Canvas rendering engine (60fps)
│   │       ├── AgentChatPalette.tsx  # Agent chat/permission UI
│   │       ├── BeltRouter.ts         # A* pathfinding for conveyor belts
│   │       ├── grid.ts               # Grid math (world↔screen coords)
│   │       └── sprites.ts            # Procedural sprite generation
│   ├── stores/                       # Zustand state management
│   │   ├── agentStore.ts             # Agent state, selection, activity log
│   │   ├── factoryStore.ts           # Projects, placements, persistence
│   │   ├── metricsStore.ts           # Token/cost tracking
│   │   └── uiStore.ts                # Viewport, UI state
│   └── styles/
│       └── rts.css                   # Factorio-style CSS (brass/brown theme)
│
├── src-tauri/                        # Rust Backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs                   # Tauri entry point
│       ├── lib.rs                    # Library exports & command registration
│       ├── acp/                      # ACP Protocol Implementation
│       │   ├── mod.rs
│       │   ├── protocol.rs           # JSON-RPC message types
│       │   ├── messages.rs           # Request/Response/Notification structs
│       │   └── codec.rs              # Newline-delimited JSON codec
│       ├── agent/                    # Agent Management
│       │   ├── mod.rs
│       │   ├── process.rs            # Subprocess stdin/stdout handling
│       │   ├── pool.rs               # Agent pool & permission handling
│       │   ├── manager.rs            # Agent lifecycle management
│       │   └── message_processor.rs  # Session update processing
│       ├── state/                    # Application State
│       │   ├── mod.rs
│       │   ├── app_state.rs          # Global state container
│       │   ├── factory.rs            # Factory layout persistence
│       │   └── metrics.rs            # Token/cost tracking
│       └── commands/                 # Tauri Commands
│           ├── mod.rs
│           ├── agent_cmds.rs         # spawn_agent, send_prompt, respond_to_permission
│           ├── factory_cmds.rs       # add/remove/move projects, agent placements
│           └── fs_cmds.rs            # count_files, scan operations
│
├── assets/                           # Static assets
│   └── acptorio.png                  # Screenshot for README
│
└── tests/                            # Integration tests
    └── acp_integration_test.rs
```

## Core Systems

### 1. Canvas Rendering System

The Factorio-style visualization is built on HTML5 Canvas with a custom rendering engine.

**FactorioRenderer.ts** - Main rendering loop:
- 60fps animation via `requestAnimationFrame`
- Layered rendering: terrain → belts → resources → agents → UI
- Procedurally generated pixel art sprites
- Position-based terrain variation for visual interest

**Rendering layers:**
```
1. Terrain (grid tiles with subtle variation)
2. Conveyor belts (animated when agent is working)
3. Resource nodes (projects as ore patches)
4. Agent machines (assemblers with status animations)
5. Selection brackets (Factorio-style yellow corners)
6. Labels and badges (agent names, file counts, pending input indicators)
```

### 2. Entity System

**Projects (Resource Nodes)**
- Appear as ore patches with different colors (8-color palette)
- Size scales with file count (2x2 to 8x8 tiles)
- Colors: copper, iron (blue-gray), uranium (green), purple, gold, blue, red, cyan
- Draggable, selectable, deletable

**Agents (Assembler Machines)**
- 2x2 tile assembling machines
- Status-based animations: idle, working, error
- Blinking red overlay when permission is needed
- Yellow badge shows pending input count

### 3. Conveyor Belt System

**BeltRouter.ts** - A* pathfinding algorithm:
- Finds shortest orthogonal path between project and agent
- Avoids obstacles (other entities)
- Generates belt segments: horizontal, vertical, corners (NE, NW, SE, SW)

**Animation:**
- Belt texture animates only when connected agent is working
- Glowing item travels along belt during active work
- Static frame when agent is idle

### 4. State Management

**factoryStore.ts** - Persistent factory layout:
```typescript
interface FactoryState {
  projects: Map<string, ProjectNode>;      // Project folders on canvas
  agentPlacements: Map<string, AgentPlacement>; // Agent positions & connections
  viewport: FactoryViewport;               // Pan/zoom state

  // Actions
  addProject(path, gridX?, gridY?): Promise<ProjectNode>;
  removeProject(id): Promise<void>;
  moveProject(id, gridX, gridY): Promise<void>;
  setAgentPlacement(agentId, gridX, gridY, projectId?, name?, workDir?): Promise<void>;
  findNextAvailablePosition(preferNear?): {x, y};
}
```

**agentStore.ts** - Agent management:
```typescript
interface AgentState {
  agents: Map<string, AgentInfo>;
  selectedAgentIds: Set<string>;
  activityLog: ActivityLogEntry[];

  // Actions
  spawnAgent(name, workingDirectory): Promise<AgentInfo>;
  stopAgent(agentId): Promise<void>;
  sendPrompt(agentId, prompt): Promise<void>;
  selectAgent(agentId, multiSelect): void;
}
```

### 5. Persistence

**Storage location:** `~/.agent-commander/factory-layout.json`

```json
{
  "version": 1,
  "projects": [
    {
      "id": "1234-abc",
      "path": "/Users/x/myproject",
      "name": "myproject",
      "grid_x": 0,
      "grid_y": 0,
      "file_count": 450,
      "color_index": 0
    }
  ],
  "agent_placements": [
    {
      "agent_id": "agent-1",
      "grid_x": 6,
      "grid_y": 0,
      "connected_project_id": "1234-abc",
      "name": "Agent-myproject",
      "working_directory": "/Users/x/myproject"
    }
  ],
  "viewport": {
    "offset_x": -100,
    "offset_y": -50,
    "zoom": 1.0
  }
}
```

**Auto-save triggers:**
- Project add/remove/move
- Agent placement changes
- Viewport changes (debounced 500ms)

**Agent restoration:**
- On startup, persisted agent placements with name/working_directory are restored
- New agent subprocess spawned, placement updated with new agent ID

## User Interactions

### Mouse Controls

| Action | Effect |
|--------|--------|
| Left click entity | Select (clear others) |
| Ctrl/Cmd + click | Multi-select toggle |
| Click empty space | Clear selection, start pan |
| Drag entity | Move to new grid position |
| Drag selected entity | Move ALL selected entities together (preserves relative positions) |
| Shift + drag | Box selection |
| Right click | Context menu |
| Scroll wheel | Zoom in/out (centered on cursor) |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **E** | Deploy agent to selected project |
| **Delete/Backspace** | Delete selected agents/projects |
| **Ctrl/Cmd + A** | Select all |
| **Escape** | Clear selection, close menus |
| **W/A/S/D** or Arrows | Pan canvas |

### Context Menu

- **Add Project** - Opens folder picker, adds project at click location
- **Delete Selected (N)** - Remove selected agents and projects

## Data Flow

### Deploy Agent to Project

```
1. User selects project, presses E (or clicks Deploy button)
2. Frontend: handleDeployAgent(projectId)
   - invoke('spawn_agent', {name: "Agent-{projectName}", working_directory: path})
3. Backend: AgentPool.spawn_agent()
   - Spawn subprocess: npx @zed-industries/claude-code-acp@latest
   - Send: initialize request
   - Send: session/new request
   - Return agent info
4. Frontend:
   - findNextAvailablePosition({x: project.grid_x, y: project.grid_y})
   - setAgentPlacement(agent.id, pos.x, pos.y, projectId, name, path)
   - selectAgent(agent.id) → opens chat palette, focuses input
5. Belt auto-routes from project to agent
```

### Send Prompt

```
1. User types in chat palette, presses Enter
2. Frontend: sendPrompt(agentId, prompt)
   - invoke('send_prompt', {agent_id, prompt})
3. Backend: Write session/prompt to agent stdin
4. Agent processes, streams session/update notifications
5. Backend: Parse JSON, emit("agent-update", payload)
6. Frontend:
   - Update activityLog
   - Agent status → "working"
   - Belt animation starts
```

### Permission Request Flow

```
1. Agent needs permission (e.g., run bash command)
2. Agent sends: input/request notification
3. Backend: Store in agent's pending_inputs, emit to frontend
4. Frontend:
   - Agent machine shows blinking red overlay
   - Yellow badge shows count
   - Chat palette shows Approve/Deny buttons
5. User clicks Approve
6. Frontend:
   - onInputResponded(inputId) → immediately hide UI
   - invoke('respond_to_permission', {agent_id, input_id, approved: true})
7. Backend: Send response to agent via stored channel
8. Agent proceeds with operation
```

## Visual Feedback States

### Agent Machine States

| State | Visual |
|-------|--------|
| Idle | Static assembler sprite |
| Working | Animated gears, belt moves, item flows |
| Pending Permission | Blinking red overlay (~1.6Hz) |
| Selected | Yellow corner brackets |
| Hovered | Dimmed corner brackets |

### Project (Resource Node) States

| State | Visual |
|-------|--------|
| Normal | Colored ore chunks (shimmering) |
| Selected | Yellow corner brackets |
| Hovered | Dimmed corner brackets |

### Conveyor Belt States

| State | Visual |
|-------|--------|
| Agent Working | Animated belt texture, glowing item travels |
| Agent Idle | Static belt texture, no item |

## Sprite System

All sprites are procedurally generated in `sprites.ts`:

**Terrain tiles:**
- Base dark brown with subtle variation
- Diagonal stripes, random patches, noise patterns
- Position-seeded for consistency

**Assembler machine:**
- Brass/bronze color scheme
- Animated frames for working state
- Frame overlays, rivets, gears

**Conveyor belts:**
- Horizontal, vertical, and 4 corner types
- 4-frame animation per type
- Yellow chevron pattern

**Resource nodes:**
- Elliptical ore chunks with shadow
- Color varies by project's color_index
- Shimmer animation

**Project colors palette:**
```typescript
const PROJECT_COLORS = [
  { main: "#b87333", light: "#cd853f", dark: "#8b4513" }, // Copper
  { main: "#6b8e9f", light: "#87ceeb", dark: "#4a6670" }, // Iron
  { main: "#4a9f4a", light: "#6fbf6f", dark: "#2d6b2d" }, // Uranium
  { main: "#9f6b9f", light: "#bf8fbf", dark: "#6b4a6b" }, // Purple
  { main: "#9f9f4a", light: "#bfbf6f", dark: "#6b6b2d" }, // Gold
  { main: "#4a6b9f", light: "#6f8fbf", dark: "#2d4a6b" }, // Blue
  { main: "#9f4a4a", light: "#bf6f6f", dark: "#6b2d2d" }, // Red
  { main: "#4a9f9f", light: "#6fbfbf", dark: "#2d6b6b" }, // Cyan
];
```

## Dependencies

### Rust (Cargo.toml)
- `tauri` - Desktop app framework
- `tokio` - Async runtime
- `serde` / `serde_json` - Serialization
- `uuid` - Agent IDs
- `dashmap` - Concurrent hashmap for agent pool
- `walkdir` - File counting
- `dirs` - Config directory paths

### Frontend (package.json)
- `react` - UI framework
- `zustand` - State management
- `@tauri-apps/api` - Tauri bindings
- `@tauri-apps/plugin-dialog` - Folder picker
- `vite` - Build tool

## Running

```bash
# Install dependencies
npm install

# Development (with hot reload)
npm run tauri dev

# Production build
npm run tauri build
```

## Environment

Requires `ANTHROPIC_API_KEY` environment variable for agent operation.

## Future Enhancements

- [ ] Multiple items flowing on belts (prompts, files, tasks)
- [ ] Agent output visualization (completed tasks exit on output belt)
- [ ] Splitters and mergers for complex routing
- [ ] Agent templates/blueprints
- [ ] Cost tracking per project
- [ ] Agent collaboration (one agent's output → another's input)
