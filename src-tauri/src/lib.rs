mod acp;
pub mod agent;
mod commands;
mod filesystem;
pub mod registry;
mod state;

use commands::{
    add_factory_project, count_files, get_agent, get_agent_icon, get_all_agent_icons,
    get_factory_layout, get_fog_state, get_metrics, get_project_path, get_project_tree,
    get_registry_agent, get_registry_agents, is_file_explored, list_agents, move_factory_project,
    preload_agent_icons, read_file, refresh_registry, remove_agent_placement,
    remove_factory_project, reset_metrics, respond_to_permission, reveal_file, retry_create_session,
    save_factory_layout, scan_project, send_prompt, set_agent_placement, set_factory_viewport,
    spawn_agent, start_agent_auth, stop_agent, stop_all_agents, update_factory_project,
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
            start_agent_auth,
            retry_create_session,
            // Filesystem commands
            scan_project,
            get_project_tree,
            get_project_path,
            reveal_file,
            get_fog_state,
            is_file_explored,
            read_file,
            count_files,
            // Metrics commands
            get_metrics,
            reset_metrics,
            // Factory commands
            get_factory_layout,
            save_factory_layout,
            add_factory_project,
            remove_factory_project,
            move_factory_project,
            update_factory_project,
            set_agent_placement,
            remove_agent_placement,
            set_factory_viewport,
            // Registry commands
            get_registry_agents,
            refresh_registry,
            get_registry_agent,
            get_agent_icon,
            get_all_agent_icons,
            preload_agent_icons,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
