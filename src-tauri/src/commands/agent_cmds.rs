use crate::agent::{AgentInfo, AgentUpdate};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use uuid::Uuid;

#[tauri::command]
pub async fn spawn_agent(
    name: String,
    working_directory: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<AgentInfo, String> {
    let info = state
        .agent_pool
        .spawn_agent(name, working_directory)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app_handle.emit("agent-spawned", &info);
    Ok(info)
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
