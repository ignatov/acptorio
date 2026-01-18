use crate::state::{AgentPlacement, AppState, FactoryLayout, FactoryViewport, ProjectNode};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_factory_layout(state: State<'_, Arc<AppState>>) -> Result<FactoryLayout, String> {
    Ok(state.factory.get_layout().await)
}

#[tauri::command]
pub async fn save_factory_layout(
    state: State<'_, Arc<AppState>>,
    layout: FactoryLayout,
) -> Result<(), String> {
    state.factory.save_layout(layout).await
}

#[tauri::command]
pub async fn add_factory_project(
    state: State<'_, Arc<AppState>>,
    id: String,
    path: String,
    name: String,
    grid_x: i32,
    grid_y: i32,
    color_index: Option<u32>,
) -> Result<FactoryLayout, String> {
    let project = ProjectNode {
        id,
        path,
        name,
        grid_x,
        grid_y,
        file_count: None,
        color_index,
    };
    state.factory.add_project(project).await
}

#[tauri::command]
pub async fn update_factory_project(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    file_count: Option<u32>,
    color_index: Option<u32>,
) -> Result<FactoryLayout, String> {
    state.factory.update_project(&project_id, file_count, color_index).await
}

#[tauri::command]
pub async fn remove_factory_project(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<FactoryLayout, String> {
    state.factory.remove_project(&project_id).await
}

#[tauri::command]
pub async fn move_factory_project(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    grid_x: i32,
    grid_y: i32,
) -> Result<FactoryLayout, String> {
    state.factory.move_project(&project_id, grid_x, grid_y).await
}

#[tauri::command]
pub async fn set_agent_placement(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
    grid_x: i32,
    grid_y: i32,
    connected_project_id: Option<String>,
    name: Option<String>,
    working_directory: Option<String>,
    provider_id: Option<String>,
) -> Result<FactoryLayout, String> {
    let placement = AgentPlacement {
        agent_id,
        grid_x,
        grid_y,
        connected_project_id,
        name,
        working_directory,
        provider_id,
    };
    state.factory.set_agent_placement(placement).await
}

#[tauri::command]
pub async fn remove_agent_placement(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
) -> Result<FactoryLayout, String> {
    state.factory.remove_agent_placement(&agent_id).await
}

#[tauri::command]
pub async fn set_factory_viewport(
    state: State<'_, Arc<AppState>>,
    offset_x: f64,
    offset_y: f64,
    zoom: f64,
) -> Result<FactoryLayout, String> {
    let viewport = FactoryViewport {
        offset_x,
        offset_y,
        zoom,
    };
    state.factory.set_viewport(viewport).await
}
