use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tokio::sync::RwLock;

const FACTORY_LAYOUT_FILE: &str = "factory-layout.json";
const LAYOUT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectNode {
    pub id: String,
    pub path: String,
    pub name: String,
    pub grid_x: i32,
    pub grid_y: i32,
    #[serde(default)]
    pub file_count: Option<u32>,
    #[serde(default)]
    pub color_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPlacement {
    pub agent_id: String,
    pub grid_x: i32,
    pub grid_y: i32,
    pub connected_project_id: Option<String>,
    // Persisted agent metadata for restore on startup
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactoryViewport {
    pub offset_x: f64,
    pub offset_y: f64,
    pub zoom: f64,
}

impl Default for FactoryViewport {
    fn default() -> Self {
        Self {
            offset_x: 0.0,
            offset_y: 0.0,
            zoom: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactoryLayout {
    pub version: u32,
    pub projects: Vec<ProjectNode>,
    pub agent_placements: Vec<AgentPlacement>,
    pub viewport: FactoryViewport,
}

impl Default for FactoryLayout {
    fn default() -> Self {
        Self {
            version: LAYOUT_VERSION,
            projects: Vec::new(),
            agent_placements: Vec::new(),
            viewport: FactoryViewport::default(),
        }
    }
}

pub struct FactoryStore {
    layout: RwLock<FactoryLayout>,
    storage_path: PathBuf,
}

impl FactoryStore {
    pub fn new() -> Self {
        let storage_path = Self::get_storage_path();
        let layout = Self::load_from_file(&storage_path).unwrap_or_default();

        Self {
            layout: RwLock::new(layout),
            storage_path,
        }
    }

    fn get_storage_path() -> PathBuf {
        // Use app data directory
        let base = dirs::data_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."));

        let app_dir = base.join("acptorio");
        fs::create_dir_all(&app_dir).ok();

        app_dir.join(FACTORY_LAYOUT_FILE)
    }

    fn load_from_file(path: &PathBuf) -> Option<FactoryLayout> {
        let content = fs::read_to_string(path).ok()?;
        let layout: FactoryLayout = serde_json::from_str(&content).ok()?;

        // Accept version 1 or 2 (serde defaults handle missing fields)
        if layout.version != LAYOUT_VERSION && layout.version != 1 {
            tracing::warn!("Factory layout version mismatch, using default");
            return None;
        }

        Some(layout)
    }

    fn save_to_file(&self, layout: &FactoryLayout) -> Result<(), String> {
        let content = serde_json::to_string_pretty(layout)
            .map_err(|e| format!("Failed to serialize layout: {}", e))?;

        fs::write(&self.storage_path, content)
            .map_err(|e| format!("Failed to write layout file: {}", e))?;

        Ok(())
    }

    pub async fn get_layout(&self) -> FactoryLayout {
        self.layout.read().await.clone()
    }

    pub async fn save_layout(&self, layout: FactoryLayout) -> Result<(), String> {
        self.save_to_file(&layout)?;
        *self.layout.write().await = layout;
        Ok(())
    }

    // Project operations
    pub async fn add_project(&self, project: ProjectNode) -> Result<FactoryLayout, String> {
        let mut layout = self.layout.write().await;

        // Check if project already exists
        if layout.projects.iter().any(|p| p.path == project.path) {
            return Ok(layout.clone());
        }

        layout.projects.push(project);
        self.save_to_file(&layout)?;
        Ok(layout.clone())
    }

    pub async fn remove_project(&self, project_id: &str) -> Result<FactoryLayout, String> {
        let mut layout = self.layout.write().await;

        layout.projects.retain(|p| p.id != project_id);

        // Disconnect agents from removed project
        for placement in &mut layout.agent_placements {
            if placement.connected_project_id.as_deref() == Some(project_id) {
                placement.connected_project_id = None;
            }
        }

        self.save_to_file(&layout)?;
        Ok(layout.clone())
    }

    pub async fn move_project(
        &self,
        project_id: &str,
        grid_x: i32,
        grid_y: i32,
    ) -> Result<FactoryLayout, String> {
        let mut layout = self.layout.write().await;

        if let Some(project) = layout.projects.iter_mut().find(|p| p.id == project_id) {
            project.grid_x = grid_x;
            project.grid_y = grid_y;
        }

        self.save_to_file(&layout)?;
        Ok(layout.clone())
    }

    pub async fn update_project(
        &self,
        project_id: &str,
        file_count: Option<u32>,
        color_index: Option<u32>,
    ) -> Result<FactoryLayout, String> {
        let mut layout = self.layout.write().await;

        if let Some(project) = layout.projects.iter_mut().find(|p| p.id == project_id) {
            if file_count.is_some() {
                project.file_count = file_count;
            }
            if color_index.is_some() {
                project.color_index = color_index;
            }
        }

        self.save_to_file(&layout)?;
        Ok(layout.clone())
    }

    // Agent placement operations
    pub async fn set_agent_placement(
        &self,
        placement: AgentPlacement,
    ) -> Result<FactoryLayout, String> {
        let mut layout = self.layout.write().await;

        if let Some(existing) = layout
            .agent_placements
            .iter_mut()
            .find(|p| p.agent_id == placement.agent_id)
        {
            existing.grid_x = placement.grid_x;
            existing.grid_y = placement.grid_y;
            if placement.connected_project_id.is_some() {
                existing.connected_project_id = placement.connected_project_id;
            }
            // Update metadata if provided
            if placement.name.is_some() {
                existing.name = placement.name;
            }
            if placement.working_directory.is_some() {
                existing.working_directory = placement.working_directory;
            }
            if placement.provider_id.is_some() {
                existing.provider_id = placement.provider_id;
            }
        } else {
            layout.agent_placements.push(placement);
        }

        self.save_to_file(&layout)?;
        Ok(layout.clone())
    }

    pub async fn remove_agent_placement(&self, agent_id: &str) -> Result<FactoryLayout, String> {
        let mut layout = self.layout.write().await;
        layout.agent_placements.retain(|p| p.agent_id != agent_id);
        self.save_to_file(&layout)?;
        Ok(layout.clone())
    }

    pub async fn set_viewport(&self, viewport: FactoryViewport) -> Result<FactoryLayout, String> {
        let mut layout = self.layout.write().await;
        layout.viewport = viewport;
        self.save_to_file(&layout)?;
        Ok(layout.clone())
    }
}

impl Default for FactoryStore {
    fn default() -> Self {
        Self::new()
    }
}
