use crate::registry::RegistryAgent;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

/// Get all available agents from the registry
#[tauri::command]
pub async fn get_registry_agents(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RegistryAgent>, String> {
    Ok(state.registry.get_agents().await)
}

/// Force refresh the registry from remote
#[tauri::command]
pub async fn refresh_registry(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.registry.refresh().await
}

/// Get a specific agent by ID
#[tauri::command]
pub async fn get_registry_agent(
    agent_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<RegistryAgent>, String> {
    Ok(state.registry.get_agent(&agent_id).await)
}

/// Get cached icon for an agent (base64 data URL)
#[tauri::command]
pub fn get_agent_icon(
    agent_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, String> {
    Ok(state.registry.get_icon(&agent_id))
}

/// Preload icons for all agents
#[tauri::command]
pub async fn preload_agent_icons(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.registry.preload_icons().await;
    Ok(())
}

/// Get all cached icons as a map of agent_id -> data_url
#[tauri::command]
pub fn get_all_agent_icons(
    state: State<'_, Arc<AppState>>,
) -> Result<std::collections::HashMap<String, String>, String> {
    Ok(state.registry.get_all_icons())
}
