use super::types::{get_claude_agent, Registry, RegistryAgent};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use tracing::{info, warn};

const REGISTRY_URL: &str =
    "https://github.com/agentclientprotocol/registry/releases/latest/download/registry.json";
const CACHE_TTL_HOURS: u64 = 1;

pub struct RegistryService {
    registry: RwLock<Registry>,
    cache_path: PathBuf,
    icons_dir: PathBuf,
    last_fetch: RwLock<Option<u64>>,
}

impl RegistryService {
    pub fn new() -> Self {
        let base_path = Self::get_cache_dir();
        let cache_path = base_path.join("registry.json");
        let icons_dir = base_path.join("icons");

        // Create icons directory
        fs::create_dir_all(&icons_dir).ok();

        // Try to load from cache
        let registry = Self::load_cached_registry(&cache_path).unwrap_or_default();

        Self {
            registry: RwLock::new(registry),
            cache_path,
            icons_dir,
            last_fetch: RwLock::new(None),
        }
    }

    fn get_cache_dir() -> PathBuf {
        let base = dirs::data_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."));

        let app_dir = base.join("acptorio");
        fs::create_dir_all(&app_dir).ok();
        app_dir
    }

    fn load_cached_registry(path: &PathBuf) -> Option<Registry> {
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn save_registry(&self, registry: &Registry) {
        if let Ok(content) = serde_json::to_string_pretty(registry) {
            if let Err(e) = fs::write(&self.cache_path, content) {
                warn!("Failed to save registry cache: {}", e);
            }
        }
    }

    fn get_icon_path(&self, agent_id: &str) -> PathBuf {
        self.icons_dir.join(format!("{}.svg", agent_id))
    }

    fn current_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    fn is_cache_stale(&self, last_fetch: Option<u64>) -> bool {
        match last_fetch {
            None => true,
            Some(ts) => {
                let now = Self::current_timestamp();
                now - ts > CACHE_TTL_HOURS * 3600
            }
        }
    }

    /// Fetch registry from remote (called at startup and on refresh)
    pub async fn fetch_registry(&self) -> Result<(), String> {
        info!("Fetching registry from {}", REGISTRY_URL);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let response = client
            .get(REGISTRY_URL)
            .header("User-Agent", "AgentCommander/1.0")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch registry: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Registry fetch failed with status: {}",
                response.status()
            ));
        }

        let registry: Registry = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse registry: {}", e))?;

        info!("Fetched {} agents from registry", registry.agents.len());

        // Update cache
        {
            let mut reg = self.registry.write().await;
            *reg = registry.clone();
        }
        {
            let mut last = self.last_fetch.write().await;
            *last = Some(Self::current_timestamp());
        }

        // Save to disk
        self.save_registry(&registry);

        // Download all icons
        for agent in &registry.agents {
            if let Some(icon_url) = &agent.icon {
                if let Err(e) = self.download_icon(&agent.id, icon_url).await {
                    warn!("Failed to download icon for {}: {}", agent.id, e);
                }
            }
        }

        Ok(())
    }

    /// Get all agents (fetches if cache is stale), always includes Claude first
    pub async fn get_agents(&self) -> Vec<RegistryAgent> {
        // Check if we should fetch
        let should_fetch = {
            let last = self.last_fetch.read().await;
            self.is_cache_stale(*last)
        };

        if should_fetch {
            // Fetch in background, don't block
            let _ = self.fetch_registry().await;
        }

        // Always include Claude first, then registry agents
        let mut agents = vec![get_claude_agent()];
        let registry_agents = self.registry.read().await.agents.clone();

        // Add registry agents, but skip if there's already a "claude" entry
        for agent in registry_agents {
            if agent.id != "claude" {
                agents.push(agent);
            }
        }

        agents
    }

    /// Force refresh the registry
    pub async fn refresh(&self) -> Result<(), String> {
        self.fetch_registry().await
    }

    /// Get a specific agent by ID
    pub async fn get_agent(&self, id: &str) -> Option<RegistryAgent> {
        // Check for built-in Claude first
        if id == "claude" {
            return Some(get_claude_agent());
        }

        self.registry
            .read()
            .await
            .agents
            .iter()
            .find(|a| a.id == id)
            .cloned()
    }

    /// Get all cached icons as base64 data URLs
    pub fn get_all_icons(&self) -> HashMap<String, String> {
        let mut icons = HashMap::new();

        if let Ok(entries) = fs::read_dir(&self.icons_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "svg").unwrap_or(false) {
                    if let Some(agent_id) = path.file_stem().and_then(|s| s.to_str()) {
                        if let Ok(content) = fs::read(&path) {
                            use base64::Engine;
                            let base64_str = base64::engine::general_purpose::STANDARD.encode(&content);
                            let data_url = format!("data:image/svg+xml;base64,{}", base64_str);
                            icons.insert(agent_id.to_string(), data_url);
                        }
                    }
                }
            }
        }

        icons
    }

    /// Get cached icon for an agent (base64 data URL)
    pub fn get_icon(&self, agent_id: &str) -> Option<String> {
        let path = self.get_icon_path(agent_id);
        if path.exists() {
            if let Ok(content) = fs::read(&path) {
                use base64::Engine;
                let base64_str = base64::engine::general_purpose::STANDARD.encode(&content);
                return Some(format!("data:image/svg+xml;base64,{}", base64_str));
            }
        }
        None
    }

    /// Download icon SVG file to cache
    async fn download_icon(&self, agent_id: &str, icon_url: &str) -> Result<(), String> {
        let icon_path = self.get_icon_path(agent_id);

        // Skip if already exists
        if icon_path.exists() {
            return Ok(());
        }

        info!("Downloading icon for {} from {}", agent_id, icon_url);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let response = client
            .get(icon_url)
            .header("User-Agent", "AgentCommander/1.0")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch icon: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Icon fetch failed with status: {}", response.status()));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read icon bytes: {}", e))?;

        fs::write(&icon_path, &bytes)
            .map_err(|e| format!("Failed to save icon: {}", e))?;

        info!("Saved icon for {} ({} bytes)", agent_id, bytes.len());
        Ok(())
    }

    /// Fetch icon (for backward compatibility)
    pub async fn fetch_icon(&self, agent_id: &str) -> Result<String, String> {
        let agent = self
            .get_agent(agent_id)
            .await
            .ok_or_else(|| "Agent not found".to_string())?;

        if let Some(icon_url) = &agent.icon {
            self.download_icon(agent_id, icon_url).await?;
        }

        self.get_icon(agent_id).ok_or_else(|| "Icon not found".to_string())
    }

    /// Preload icons for all agents
    pub async fn preload_icons(&self) {
        let agents = self.get_agents().await;
        for agent in agents {
            if let Some(icon_url) = &agent.icon {
                if let Err(e) = self.download_icon(&agent.id, icon_url).await {
                    warn!("Failed to download icon for {}: {}", agent.id, e);
                }
            }
        }
    }
}

impl Default for RegistryService {
    fn default() -> Self {
        Self::new()
    }
}
