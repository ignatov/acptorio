use crate::filesystem::{FogState, ProjectTree, FileSystemWatcher};
use crate::state::{AppState, Metrics};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use once_cell::sync::Lazy;

// Global file watcher - we only need one at a time
static FILE_WATCHER: Lazy<Mutex<Option<FileSystemWatcher>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
pub async fn scan_project(
    path: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<ProjectTree, String> {
    let path_buf = PathBuf::from(&path);
    let tree = state.load_project(path_buf.clone()).await?;

    // Start file watcher for this project
    if let Ok(mut watcher_guard) = FILE_WATCHER.lock() {
        // Create new watcher (drops old one if exists)
        match FileSystemWatcher::new(app_handle.clone()) {
            Ok(mut watcher) => {
                if let Err(e) = watcher.watch(&path_buf) {
                    eprintln!("Failed to watch directory: {}", e);
                } else {
                    println!("File watcher started for: {}", path);
                }
                *watcher_guard = Some(watcher);
            }
            Err(e) => {
                eprintln!("Failed to create file watcher: {}", e);
            }
        }
    }

    let _ = app_handle.emit("project-loaded", &tree);
    Ok(tree)
}

#[tauri::command]
pub async fn get_project_tree(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ProjectTree>, String> {
    Ok(state.get_project_tree().await)
}

#[tauri::command]
pub async fn get_project_path(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    Ok(state.get_project_path().await.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn reveal_file(path: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.reveal_file(&path);
    Ok(())
}

#[tauri::command]
pub fn get_fog_state(state: State<'_, Arc<AppState>>) -> Result<FogState, String> {
    Ok(FogState::from(state.fog.as_ref()))
}

#[tauri::command]
pub fn is_file_explored(path: String, state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    Ok(state.fog.is_explored(&path))
}

#[tauri::command]
pub fn get_metrics(state: State<'_, Arc<AppState>>) -> Result<Metrics, String> {
    Ok(state.metrics.get_metrics())
}

#[tauri::command]
pub fn reset_metrics(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.metrics.reset();
    Ok(())
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}
