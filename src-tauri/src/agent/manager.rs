use super::pool::AgentPool;
use super::process::{AgentInfo, AgentProcessError, AgentUpdate};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

pub struct AgentManager {
    pool: Arc<AgentPool>,
    app_handle: AppHandle,
}

impl AgentManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            pool: Arc::new(AgentPool::new()),
            app_handle,
        }
    }

    pub async fn spawn_agent(
        &self,
        name: String,
        working_directory: String,
    ) -> Result<AgentInfo, AgentProcessError> {
        let info = self.pool.spawn_agent(name, working_directory).await?;

        // Emit event to frontend
        let _ = self.app_handle.emit("agent-spawned", &info);

        Ok(info)
    }

    pub async fn get_agent(&self, id: &uuid::Uuid) -> Option<AgentInfo> {
        self.pool.get_agent_info(id).await
    }

    pub async fn list_agents(&self) -> Vec<AgentInfo> {
        self.pool.list_agents().await
    }

    pub async fn send_prompt(
        &self,
        agent_id: uuid::Uuid,
        prompt: String,
    ) -> Result<String, AgentProcessError> {
        let (tx, mut rx) = mpsc::channel::<AgentUpdate>(100);
        let app_handle = self.app_handle.clone();

        // Spawn task to forward updates to frontend
        tokio::spawn(async move {
            while let Some(update) = rx.recv().await {
                let _ = app_handle.emit("agent-update", &update);
            }
        });

        let result = self.pool.send_prompt(agent_id, &prompt, tx).await?;

        // Emit completion
        if let Some(info) = self.pool.get_agent_info(&agent_id).await {
            let _ = self.app_handle.emit("agent-status-changed", &info);
        }

        Ok(result)
    }

    pub async fn stop_agent(&self, agent_id: &uuid::Uuid) -> Result<(), AgentProcessError> {
        self.pool.stop_agent(agent_id).await?;
        let _ = self.app_handle.emit("agent-stopped", agent_id);
        Ok(())
    }

    pub async fn stop_all(&self) -> Result<(), AgentProcessError> {
        self.pool.stop_all().await
    }

    pub fn agent_count(&self) -> usize {
        self.pool.agent_count()
    }
}
