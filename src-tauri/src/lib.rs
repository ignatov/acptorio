mod acp;
pub mod agent;
mod commands;
mod filesystem;
mod state;

use commands::{
    get_agent, get_fog_state, get_metrics, get_project_path, get_project_tree, is_file_explored,
    list_agents, read_file, reset_metrics, respond_to_permission, reveal_file, scan_project,
    send_prompt, spawn_agent, stop_agent, stop_all_agents,
};
use state::AppState;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(AppState::new()))
        .invoke_handler(tauri::generate_handler![
            // Agent commands
            spawn_agent,
            stop_agent,
            list_agents,
            get_agent,
            send_prompt,
            stop_all_agents,
            respond_to_permission,
            // Filesystem commands
            scan_project,
            get_project_tree,
            get_project_path,
            reveal_file,
            get_fog_state,
            is_file_explored,
            read_file,
            // Metrics commands
            get_metrics,
            reset_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
