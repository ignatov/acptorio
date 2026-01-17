use crate::agent::AgentPool;
use crate::filesystem::{FogOfWar, ProjectScanner, ProjectTree};
use crate::state::factory::FactoryStore;
use crate::state::metrics::MetricsTracker;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct AppState {
    pub agent_pool: Arc<AgentPool>,
    pub project_tree: RwLock<Option<ProjectTree>>,
    pub project_path: RwLock<Option<PathBuf>>,
    pub fog: Arc<FogOfWar>,
    pub metrics: Arc<MetricsTracker>,
    pub scanner: ProjectScanner,
    pub factory: Arc<FactoryStore>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            agent_pool: Arc::new(AgentPool::new()),
            project_tree: RwLock::new(None),
            project_path: RwLock::new(None),
            fog: Arc::new(FogOfWar::new()),
            metrics: Arc::new(MetricsTracker::new()),
            scanner: ProjectScanner::new(),
            factory: Arc::new(FactoryStore::new()),
        }
    }

    pub async fn load_project(&self, path: PathBuf) -> Result<ProjectTree, String> {
        let tree = self
            .scanner
            .scan(&path)
            .map_err(|e| e.to_string())?;

        *self.project_path.write().await = Some(path);
        *self.project_tree.write().await = Some(tree.clone());

        // Reset fog when loading new project
        self.fog.reset();

        Ok(tree)
    }

    pub async fn get_project_tree(&self) -> Option<ProjectTree> {
        self.project_tree.read().await.clone()
    }

    pub async fn get_project_path(&self) -> Option<PathBuf> {
        self.project_path.read().await.clone()
    }

    pub fn reveal_file(&self, path: &str) {
        self.fog.reveal(path);
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
