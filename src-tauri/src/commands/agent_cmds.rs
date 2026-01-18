use crate::agent::{AgentInfo, AgentUpdate, SpawnConfig};
use crate::registry::{Distribution, BinaryManager, get_platform};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use uuid::Uuid;

#[tauri::command]
pub async fn spawn_agent(
    name: String,
    working_directory: String,
    provider_id: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<AgentInfo, String> {
    // If provider_id is specified, look up the distribution from registry
    let info = if let Some(ref pid) = provider_id {
        let agent = state
            .registry
            .get_agent(pid)
            .await
            .ok_or_else(|| format!("Unknown provider: {}", pid))?;

        let (command, args) = build_spawn_command(&agent.distribution, &agent.id, &agent.version).await?;

        let config = SpawnConfig {
            name,
            working_directory,
            provider_id: Some(agent.id.clone()),
            provider_name: Some(agent.name.clone()),
            command,
            args,
        };

        state
            .agent_pool
            .spawn_agent_with_config(config)
            .await
            .map_err(|e| e.to_string())?
    } else {
        // Default to the backward-compatible spawn
        state
            .agent_pool
            .spawn_agent(name, working_directory)
            .await
            .map_err(|e| e.to_string())?
    };

    let _ = app_handle.emit("agent-spawned", &info);
    Ok(info)
}

/// Build command and args from a Distribution
async fn build_spawn_command(
    distribution: &Distribution,
    agent_id: &str,
    version: &str,
) -> Result<(String, Vec<String>), String> {
    // Check for npx distribution first
    if let Some(ref npx) = distribution.npx {
        let mut args = vec![npx.package.clone()];
        args.extend(npx.args.clone());
        return Ok(("npx".to_string(), args));
    }

    // Check for binary distribution
    if let Some(ref binaries) = distribution.binary {
        let platform = get_platform()
            .ok_or_else(|| "Unsupported platform".to_string())?;

        if let Some(binary_info) = binaries.get(platform) {
            // Download and cache the binary
            let binary_manager = BinaryManager::new();
            let binary_path = binary_manager
                .get_binary(agent_id, version, &binary_info.archive, &binary_info.cmd)
                .await
                .map_err(|e| format!("Failed to get binary: {}", e))?;

            let cmd = binary_path
                .to_str()
                .ok_or_else(|| "Invalid binary path".to_string())?
                .to_string();

            return Ok((cmd, binary_info.args.clone()));
        } else {
            return Err(format!("Binary not available for platform: {}", platform));
        }
    }

    Err("No supported distribution method found".to_string())
}

#[tauri::command]
pub async fn stop_agent(
    agent_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let id = Uuid::parse_str(&agent_id).map_err(|e| e.to_string())?;
    state
        .agent_pool
        .stop_agent(&id)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app_handle.emit("agent-stopped", &agent_id);
    Ok(())
}

#[tauri::command]
pub async fn list_agents(state: State<'_, Arc<AppState>>) -> Result<Vec<AgentInfo>, String> {
    Ok(state.agent_pool.list_agents().await)
}

#[tauri::command]
pub async fn get_agent(
    agent_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<AgentInfo>, String> {
    let id = Uuid::parse_str(&agent_id).map_err(|e| e.to_string())?;
    Ok(state.agent_pool.get_agent_info(&id).await)
}

#[tauri::command]
pub async fn send_prompt(
    agent_id: String,
    prompt: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let id = Uuid::parse_str(&agent_id).map_err(|e| e.to_string())?;

    let (tx, mut rx) = mpsc::channel::<AgentUpdate>(100);
    let app_handle_clone = app_handle.clone();
    let fog = state.fog.clone();

    // Forward updates to frontend
    tokio::spawn(async move {
        while let Some(update) = rx.recv().await {
            // Reveal files in fog when agent accesses them
            if let Some(ref file) = update.current_file {
                fog.reveal(file);
                let _ = app_handle_clone.emit("fog-revealed", file);
            }
            let _ = app_handle_clone.emit("agent-update", &update);
        }
    });

    let result = state
        .agent_pool
        .send_prompt(id, &prompt, tx)
        .await
        .map_err(|e| e.to_string())?;

    // Emit completion
    if let Some(info) = state.agent_pool.get_agent_info(&id).await {
        let _ = app_handle.emit("agent-status-changed", &info);
    }

    Ok(result)
}

#[tauri::command]
pub async fn stop_all_agents(
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    state
        .agent_pool
        .stop_all()
        .await
        .map_err(|e| e.to_string())?;

    let _ = app_handle.emit("all-agents-stopped", ());
    Ok(())
}

#[tauri::command]
pub async fn respond_to_permission(
    agent_id: String,
    input_id: String,
    approved: bool,
    option_id: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let id = Uuid::parse_str(&agent_id).map_err(|e| e.to_string())?;

    println!("[DEBUG] respond_to_permission called: agent_id={}, input_id={}, approved={}", agent_id, input_id, approved);

    state
        .agent_pool
        .respond_to_permission(&id, &input_id, approved, option_id)
        .map_err(|e| e.to_string())?;

    println!("[DEBUG] respond_to_permission succeeded");

    // Emit an event to notify about the permission response
    let _ = app_handle.emit("permission-responded", serde_json::json!({
        "agent_id": agent_id,
        "input_id": input_id,
        "approved": approved,
    }));

    // Refresh agent info (still async)
    if let Some(info) = state.agent_pool.get_agent_info(&id).await {
        let _ = app_handle.emit("agent-status-changed", &info);
    }

    Ok(())
}

/// Start authentication for an agent
#[tauri::command]
pub async fn start_agent_auth(
    agent_id: String,
    auth_method_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<crate::acp::AuthStartResult, String> {
    let id = Uuid::parse_str(&agent_id).map_err(|e| e.to_string())?;

    let result = state
        .agent_pool
        .start_auth(&id, &auth_method_id)
        .await
        .map_err(|e| e.to_string())?;

    // If auth returned a URL, open it in the browser
    if let Some(ref url) = result.url {
        if let Err(e) = tauri_plugin_opener::open_url(url, None::<&str>) {
            tracing::warn!("Failed to open auth URL: {}", e);
        }
    }

    // Emit auth status
    let _ = app_handle.emit("agent-auth-started", serde_json::json!({
        "agent_id": agent_id,
        "auth_method_id": auth_method_id,
        "url": result.url,
        "message": result.message,
        "completed": result.completed,
    }));

    // If auth completed, try to create session
    if result.completed {
        // Try to create session now
        if let Ok(session_id) = state.agent_pool.create_session(&id).await {
            let _ = app_handle.emit("agent-session-created", serde_json::json!({
                "agent_id": agent_id,
                "session_id": session_id,
            }));
        }
    }

    Ok(result)
}

/// Retry creating a session after auth (called after browser auth completes)
#[tauri::command]
pub async fn retry_create_session(
    agent_id: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let id = Uuid::parse_str(&agent_id).map_err(|e| e.to_string())?;

    let session_id = state
        .agent_pool
        .create_session(&id)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app_handle.emit("agent-session-created", serde_json::json!({
        "agent_id": agent_id,
        "session_id": session_id,
    }));

    // Refresh agent info
    if let Some(info) = state.agent_pool.get_agent_info(&id).await {
        let _ = app_handle.emit("agent-status-changed", &info);
    }

    Ok(session_id)
}
