# acptorio - Architecture

A Factorio-inspired desktop application for orchestrating AI coding agents via the Agent Client Protocol (ACP).

## Tech Stack

- **Backend**: Tauri 2.0 (Rust)
- **Frontend**: React + TypeScript + Vite
- **State Management**: Zustand
- **Agent Protocol**: ACP (Agent Client Protocol) via `@zed-industries/claude-code-acp`

## Project Structure

```
acptorio/
├── src/                          # React Frontend
│   ├── App.tsx                   # Main application component
│   ├── main.tsx                  # Entry point
│   ├── components/
│   │   ├── layout/
│   │   │   ├── RTSLayout.tsx     # Main RTS-style grid layout
│   │   │   └── SelectionBox.tsx  # Box selection for units
│   │   ├── minimap/
│   │   │   ├── Minimap.tsx       # Project tree overview panel
│   │   │   ├── FileTree.tsx      # Recursive file tree component
│   │   │   ├── AgentMarker.tsx   # Agent position indicators
│   │   │   └── FogOverlay.tsx    # Unexplored files dimming
│   │   ├── mainview/
│   │   │   ├── MainView.tsx      # Central viewing area
│   │   │   ├── ActivityStream.tsx # Real-time agent activity logs
│   │   │   └── FileExplorer.tsx  # File content viewer
│   │   ├── units/
│   │   │   ├── UnitPortraits.tsx # Agent status cards panel
│   │   │   ├── AgentCard.tsx     # Individual agent card
│   │   │   ├── HealthBar.tsx     # Progress visualization
│   │   │   └── ManaBar.tsx       # Token usage bar
│   │   ├── command/
│   │   │   ├── CommandPanel.tsx  # Task input and controls
│   │   │   └── TaskQueue.tsx     # Pending tasks & permissions
│   │   └── resources/
│   │       ├── ResourceBar.tsx   # Top resource display
│   │       └── TokenMeter.tsx    # Token usage gauge
│   ├── stores/                   # Zustand state management
│   │   ├── agentStore.ts         # Agent state & actions
│   │   ├── projectStore.ts       # Project tree & fog of war
│   │   ├── metricsStore.ts       # Token/cost tracking
│   │   └── uiStore.ts            # UI state (selection, etc.)
│   ├── hooks/
│   │   ├── useTauriEvents.ts     # Tauri event listeners
│   │   ├── useAgent.ts           # Agent-related hooks
│   │   └── useSelection.ts       # Unit selection logic
│   └── types/
│       ├── agent.ts              # Agent types
│       ├── project.ts            # Project/file types
│       └── acp.ts                # ACP protocol types
│
├── src-tauri/                    # Rust Backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs               # Tauri entry point
│       ├── lib.rs                # Library exports
│       ├── acp/                  # ACP Protocol Implementation
│       │   ├── mod.rs
│       │   ├── protocol.rs       # JSON-RPC message types
│       │   ├── messages.rs       # Request/Response structs
│       │   └── codec.rs          # Newline-delimited JSON codec
│       ├── agent/                # Agent Management
│       │   ├── mod.rs
│       │   ├── process.rs        # Subprocess stdin/stdout handling
│       │   ├── pool.rs           # Agent pool & permission handling
│       │   ├── manager.rs        # Agent lifecycle management
│       │   └── message_processor.rs # Session update processing
│       ├── filesystem/           # File System "Map"
│       │   ├── mod.rs
│       │   ├── scanner.rs        # Project tree builder
│       │   ├── watcher.rs        # notify-rs file watching
│       │   └── fog.rs            # Fog of war tracking
│       ├── state/                # Application State
│       │   ├── mod.rs
│       │   ├── app_state.rs      # Global state container
│       │   └── metrics.rs        # Token/cost tracking
│       └── commands/             # Tauri Commands
│           ├── mod.rs
│           ├── agent_cmds.rs     # spawn_agent, send_prompt, etc.
│           └── fs_cmds.rs        # scan_project, file operations
│
└── tests/                        # Integration tests
    ├── acp_integration_test.rs
    └── agent_process_test.rs
```

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        AGENT COMMANDER                                │
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                  REACT FRONTEND (WebView)                       │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │  │
│  │  │ Minimap  │ │Main View │ │ Command  │ │  Resource Bar    │   │  │
│  │  │(Project  │ │(Activity │ │ Panel    │ │  (Tokens, Cost)  │   │  │
│  │  │ Tree)    │ │ Stream)  │ │(Tasks)   │ │                  │   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │              Unit Portraits Panel                         │  │  │
│  │  │  [Agent 1: ██████░░ 75%]  [Agent 2: ████████ 100%]       │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                         │ Zustand Store                        │  │
│  └─────────────────────────┼──────────────────────────────────────┘  │
│                            │ invoke() / events                       │
│  ┌─────────────────────────┼──────────────────────────────────────┐  │
│  │                    RUST BACKEND                                 │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐  │  │
│  │  │  AgentPool   │ │ FS Watcher   │ │  Project Scanner       │  │  │
│  │  │(Spawn/Stop)  │ │ (notify-rs)  │ │  (Tree Builder)        │  │  │
│  │  └──────┬───────┘ └──────────────┘ └────────────────────────┘  │  │
│  │         │                                                       │  │
│  │  ┌──────┴─────────────────────────────────────────────────┐    │  │
│  │  │               ACP Process Pool                          │    │  │
│  │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐             │    │  │
│  │  │  │ Agent 1   │ │ Agent 2   │ │ Agent N   │   ...       │    │  │
│  │  │  │(subprocess)│ │(subprocess)│ │(subprocess)│           │    │  │
│  │  │  │stdin/stdout│ │stdin/stdout│ │stdin/stdout│           │    │  │
│  │  │  └───────────┘ └───────────┘ └───────────┘             │    │  │
│  │  └────────────────────────────────────────────────────────┘    │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               │     claude-code-acp           │
               │   (ACP JSON-RPC over stdio)   │
               └───────────────────────────────┘
```

## Key Features

### Agent Management
- **Spawn/Stop Agents**: Deploy multiple AI agents as subprocesses
- **ACP Protocol**: Full JSON-RPC 2.0 communication over stdio
- **Permission Handling**: Interactive approval for tool use (file writes, bash commands)
- **Session Management**: Initialize, create sessions, send prompts

### RTS-Style UI
- **Minimap**: Project tree with fog of war (unexplored files dimmed)
- **Unit Portraits**: Agent cards with health (progress) and mana (tokens) bars
- **Activity Stream**: Real-time log of agent actions
- **Command Panel**: Send tasks to selected agents

### File System Integration
- **Project Scanner**: Builds file tree from directory
- **File Watcher**: Real-time updates via notify-rs
- **Fog of War**: Track which files agents have accessed

## Data Flow

### Spawn Agent
```
1. User clicks "Deploy Agent"
2. Frontend: invoke('spawn_agent', {name, working_directory})
3. Backend: AgentPool.spawn_agent()
   - Spawn subprocess: npx @zed-industries/claude-code-acp@latest
   - Send: initialize request
   - Send: session/new request
   - Store agent in pool
4. Backend: emit("agent-spawned", agent_info)
5. Frontend: agentStore.addAgent() → UI shows new unit portrait
```

### Send Command
```
1. User types task, clicks "Execute"
2. Frontend: invoke('send_prompt', {agent_id, prompt})
3. Backend: Write session/prompt to agent stdin
4. Agent streams session/update notifications
5. Backend: parse JSON, emit("agent-update", payload)
6. Frontend: Update activity stream, progress bars
```

### Permission Request
```
1. Agent needs permission (e.g., write file)
2. Agent sends: session/request_permission request
3. Backend: Store oneshot channel, emit to frontend
4. Frontend: Show Approve/Deny buttons in TaskQueue
5. User clicks Approve
6. Frontend: invoke('respond_to_permission', {...})
7. Backend: Send response via stored channel
8. Agent proceeds with operation
```

## Dependencies

### Rust (Cargo.toml)
- `tauri` - Desktop app framework
- `tokio` - Async runtime
- `serde` / `serde_json` - Serialization
- `uuid` - Agent IDs
- `dashmap` - Concurrent hashmap for agent pool
- `notify` - File system watching
- `thiserror` - Error handling

### Frontend (package.json)
- `react` - UI framework
- `zustand` - State management
- `@tauri-apps/api` - Tauri bindings
- `vite` - Build tool

## Running

```bash
# Install dependencies
npm install

# Development
npm run tauri dev

# Build
npm run tauri build
```

## Environment

Requires `ANTHROPIC_API_KEY` environment variable for agent operation.
