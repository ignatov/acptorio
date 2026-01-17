use super::process::{AgentInfo, AgentProcess, AgentProcessError, AgentUpdate, PermissionUserResponse};
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

/// Key for pending permissions: "agent_id:input_id"
type PermissionKey = String;

/// Global storage for pending permission response channels (avoids deadlock)
pub struct PendingPermissions {
    channels: DashMap<PermissionKey, oneshot::Sender<PermissionUserResponse>>,
}

impl PendingPermissions {
    pub fn new() -> Self {
        Self {
            channels: DashMap::new(),
        }
    }

    pub fn store(&self, agent_id: Uuid, input_id: &str, tx: oneshot::Sender<PermissionUserResponse>) {
        let key = format!("{}:{}", agent_id, input_id);
        self.channels.insert(key, tx);
    }

    pub fn respond(&self, agent_id: Uuid, input_id: &str, response: PermissionUserResponse) -> Result<(), AgentProcessError> {
        let key = format!("{}:{}", agent_id, input_id);
        if let Some((_, tx)) = self.channels.remove(&key) {
            tx.send(response).map_err(|_| {
                AgentProcessError::CommunicationError("Failed to send permission response".to_string())
            })?;
            Ok(())
        } else {
            Err(AgentProcessError::CommunicationError(format!("No pending permission with id: {}", input_id)))
        }
    }
}

/// Wrapper around AgentProcess to allow async locking
pub struct AgentHandle {
    inner: Arc<Mutex<AgentProcess>>,
}

impl AgentHandle {
    fn new(agent: AgentProcess) -> Self {
        Self {
            inner: Arc::new(Mutex::new(agent)),
        }
    }

    pub async fn info(&self) -> AgentInfo {
        self.inner.lock().await.info()
    }

    pub async fn stop(&self) -> Result<(), AgentProcessError> {
        self.inner.lock().await.stop().await
    }
}

pub struct AgentPool {
    agents: DashMap<Uuid, AgentHandle>,
    pending_permissions: Arc<PendingPermissions>,
}

impl AgentPool {
    pub fn new() -> Self {
        Self {
            agents: DashMap::new(),
            pending_permissions: Arc::new(PendingPermissions::new()),
        }
    }

    pub fn get_pending_permissions(&self) -> Arc<PendingPermissions> {
        self.pending_permissions.clone()
    }

    pub async fn spawn_agent(
        &self,
        name: String,
        working_directory: String,
    ) -> Result<AgentInfo, AgentProcessError> {
        let mut agent = AgentProcess::spawn(name, working_directory).await?;
        agent.initialize().await?;
        agent.create_session().await?;

        let info = agent.info();
        let handle = AgentHandle::new(agent);
        self.agents.insert(info.id, handle);
        Ok(info)
    }

    pub async fn get_agent_info(&self, id: &Uuid) -> Option<AgentInfo> {
        if let Some(handle) = self.agents.get(id) {
            Some(handle.info().await)
        } else {
            None
        }
    }

    pub async fn list_agents(&self) -> Vec<AgentInfo> {
        let mut infos = Vec::new();
        for entry in self.agents.iter() {
            infos.push(entry.value().info().await);
        }
        infos
    }

    pub async fn send_prompt(
        &self,
        agent_id: Uuid,
        prompt: &str,
        update_tx: mpsc::Sender<AgentUpdate>,
    ) -> Result<String, AgentProcessError> {
        let handle = self
            .agents
            .get(&agent_id)
            .ok_or(AgentProcessError::NoSession)?;
        // Clone the Arc to release the DashMap lock, then use the async lock
        let handle = handle.value().inner.clone();
        let pending_perms = self.pending_permissions.clone();
        let mut agent = handle.lock().await;
        agent.send_prompt(prompt, update_tx, pending_perms).await
    }

    pub async fn stop_agent(&self, agent_id: &Uuid) -> Result<(), AgentProcessError> {
        if let Some(handle) = self.agents.get(agent_id) {
            handle.stop().await?;
        }
        self.agents.remove(agent_id);
        Ok(())
    }

    pub async fn stop_all(&self) -> Result<(), AgentProcessError> {
        let ids: Vec<Uuid> = self.agents.iter().map(|r| *r.key()).collect();
        for id in ids {
            self.stop_agent(&id).await?;
        }
        Ok(())
    }

    pub fn agent_count(&self) -> usize {
        self.agents.len()
    }

    pub fn respond_to_permission(
        &self,
        agent_id: &Uuid,
        input_id: &str,
        approved: bool,
        option_id: Option<String>,
    ) -> Result<(), AgentProcessError> {
        // Use the shared pending_permissions directly - no agent lock needed!
        let response = PermissionUserResponse { approved, option_id };
        self.pending_permissions.respond(*agent_id, input_id, response)
    }
}

impl Default for AgentPool {
    fn default() -> Self {
        Self::new()
    }
}
