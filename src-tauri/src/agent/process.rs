use crate::acp::{
    AsyncCodec, InitializeParams, JsonRpcMessage, JsonRpcRequest, JsonRpcResponse,
    PromptContent, RequestPermissionRequest, RequestPermissionResponse,
    SessionNewParams, SessionNewResult, SessionPromptParams, SessionUpdate, SessionUpdateNotification,
    LegacySessionUpdateNotification, ToolCallStatus,
};
use super::pool::PendingPermissions;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub id: Uuid,
    pub name: String,
    pub status: AgentStatus,
    pub session_id: Option<String>,
    pub working_directory: String,
    pub current_file: Option<String>,
    pub progress: f64,
    pub tokens_used: u64,
    pub token_limit: u64,
    pub pending_inputs: Vec<PendingInput>,
}

/// Represents a pending input request from the agent (permission, question, etc.)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PendingInput {
    pub id: String,
    pub input_type: PendingInputType,
    pub tool_name: Option<String>,
    pub message: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PendingInputType {
    ToolPermission,
    UserQuestion,
    Confirmation,
}

/// User's response to a permission request
#[derive(Debug, Clone)]
pub struct PermissionUserResponse {
    pub approved: bool,
    pub option_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Initializing,
    Idle,
    Working,
    Paused,
    Error,
    Stopped,
}

pub struct AgentProcess {
    pub id: Uuid,
    pub name: String,
    child: Child,
    codec: AsyncCodec,
    request_id: AtomicI64,
    pub session_id: Option<String>,
    pub working_directory: String,
    pub status: AgentStatus,
    pub current_file: Option<String>,
    pub progress: f64,
    pub tokens_used: u64,
    pub pending_inputs: Vec<PendingInput>,
}

impl AgentProcess {
    pub async fn spawn(
        name: String,
        working_directory: String,
    ) -> Result<Self, AgentProcessError> {
        let id = Uuid::new_v4();

        let mut child = Command::new("npx")
            .arg("@zed-industries/claude-code-acp@latest")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(&working_directory)
            .spawn()
            .map_err(|e| AgentProcessError::SpawnFailed(e.to_string()))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AgentProcessError::StdinUnavailable)?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentProcessError::StdoutUnavailable)?;

        let codec = AsyncCodec::new(stdout, stdin);

        Ok(Self {
            id,
            name,
            child,
            codec,
            request_id: AtomicI64::new(1),
            session_id: None,
            working_directory,
            status: AgentStatus::Initializing,
            current_file: None,
            progress: 0.0,
            tokens_used: 0,
            pending_inputs: Vec::new(),
        })
    }

    fn next_request_id(&self) -> i64 {
        self.request_id.fetch_add(1, Ordering::SeqCst)
    }

    pub async fn initialize(&mut self) -> Result<(), AgentProcessError> {
        let params = InitializeParams::new();
        let request = JsonRpcRequest::new(
            self.next_request_id(),
            "initialize",
            Some(serde_json::to_value(params).unwrap()),
        );

        let json = serde_json::to_string(&request).unwrap();
        self.codec
            .write_message(&json)
            .await
            .map_err(|e| AgentProcessError::CommunicationError(e.to_string()))?;

        // Wait for initialize response
        loop {
            if let Some(msg) = self
                .codec
                .read_message()
                .await
                .map_err(|e| AgentProcessError::CommunicationError(e.to_string()))?
            {
                if let JsonRpcMessage::Response(resp) = msg {
                    if resp.error.is_some() {
                        return Err(AgentProcessError::InitializeFailed(
                            resp.error.unwrap().message,
                        ));
                    }
                    break;
                }
            }
        }

        // Send initialized notification
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        self.codec
            .write_message(&notification.to_string())
            .await
            .map_err(|e| AgentProcessError::CommunicationError(e.to_string()))?;

        self.status = AgentStatus::Idle;
        Ok(())
    }

    pub async fn create_session(&mut self) -> Result<String, AgentProcessError> {
        let params = SessionNewParams {
            cwd: self.working_directory.clone(),
            mcp_servers: vec![],
        };

        let request = JsonRpcRequest::new(
            self.next_request_id(),
            "session/new",
            Some(serde_json::to_value(params).unwrap()),
        );

        let json = serde_json::to_string(&request).unwrap();
        self.codec
            .write_message(&json)
            .await
            .map_err(|e| AgentProcessError::CommunicationError(e.to_string()))?;

        // Wait for session/new response
        loop {
            if let Some(msg) = self
                .codec
                .read_message()
                .await
                .map_err(|e| AgentProcessError::CommunicationError(e.to_string()))?
            {
                if let JsonRpcMessage::Response(resp) = msg {
                    if let Some(err) = resp.error {
                        return Err(AgentProcessError::SessionCreateFailed(err.message));
                    }
                    if let Some(result) = resp.result {
                        let session_result: SessionNewResult =
                            serde_json::from_value(result).map_err(|e| {
                                AgentProcessError::CommunicationError(e.to_string())
                            })?;
                        self.session_id = Some(session_result.session_id.clone());
                        return Ok(session_result.session_id);
                    }
                }
            }
        }
    }

    pub async fn send_prompt(
        &mut self,
        prompt: &str,
        update_tx: mpsc::Sender<AgentUpdate>,
        pending_permissions: Arc<PendingPermissions>,
    ) -> Result<String, AgentProcessError> {
        let session_id = self
            .session_id
            .as_ref()
            .ok_or(AgentProcessError::NoSession)?
            .clone();

        println!("[DEBUG] Agent {} sending prompt to session {}", self.id, session_id);
        info!("Agent {} sending prompt to session {}", self.id, session_id);
        self.status = AgentStatus::Working;
        self.progress = 0.0;

        let params = SessionPromptParams {
            session_id: session_id.clone(),
            prompt: vec![PromptContent::text(prompt)],
        };

        let request = JsonRpcRequest::new(
            self.next_request_id(),
            "session/prompt",
            Some(serde_json::to_value(&params).unwrap()),
        );

        let json = serde_json::to_string(&request).unwrap();
        println!("[DEBUG] Sending request: {}", json);
        debug!("Sending request: {}", json);
        self.codec
            .write_message(&json)
            .await
            .map_err(|e| AgentProcessError::CommunicationError(e.to_string()))?;

        println!("[DEBUG] Request sent, waiting for response...");
        info!("Request sent, waiting for response...");

        // Stream updates until we get the final response
        // Text content comes through notifications, not the final response
        let mut accumulated_text = String::new();

        loop {
            if let Some(msg) = self
                .codec
                .read_message()
                .await
                .map_err(|e| {
                    error!("Read error: {}", e);
                    AgentProcessError::CommunicationError(e.to_string())
                })?
            {
                match &msg {
                    JsonRpcMessage::Notification(notif) => {
                        println!("[DEBUG] Received notification: {} params={:?}", notif.method, notif.params);
                        debug!("Received notification: {}", notif.method);
                        if notif.method == "session/update" {
                            if let Some(params) = &notif.params {
                                self.handle_session_update(params, &update_tx, &mut accumulated_text).await;
                            }
                        }
                    }
                    JsonRpcMessage::Response(resp) => {
                        debug!("Received response: {:?}", resp);
                        if let Some(err) = &resp.error {
                            error!("Response error: {}", err.message);
                            self.status = AgentStatus::Error;
                            return Err(AgentProcessError::PromptFailed(err.message.clone()));
                        }
                        // Response received - the stopReason indicates completion
                        // The actual text content comes from accumulated notifications
                        if resp.result.is_some() {
                            info!("Prompt completed, accumulated text length: {}", accumulated_text.len());
                            self.status = AgentStatus::Idle;
                            self.progress = 100.0;
                            return Ok(accumulated_text);
                        }
                    }
                    JsonRpcMessage::Request(req) => {
                        println!("[DEBUG] Received REQUEST from agent: {} id={} params={:?}", req.method, req.id, req.params);
                        info!("Received request from agent: {}", req.method);
                        self.handle_incoming_request(req.id, &req.method, req.params.as_ref(), &update_tx, &pending_permissions).await?;
                    }
                }
            }
        }
    }

    /// Handle session/update notifications from the agent
    async fn handle_session_update(
        &mut self,
        params: &Value,
        update_tx: &mpsc::Sender<AgentUpdate>,
        accumulated_text: &mut String,
    ) {
        // Try parsing as new typed SessionUpdate format first
        match serde_json::from_value::<SessionUpdateNotification>(params.clone()) {
            Ok(notification) => {
                println!("[DEBUG] Parsed typed SessionUpdate: {:?}", notification.update);
                self.process_typed_update(&notification.update, update_tx, accumulated_text).await;
                return;
            }
            Err(e) => {
                println!("[DEBUG] Failed to parse as typed SessionUpdate: {}", e);
            }
        }

        // Fall back to legacy string-based format
        match serde_json::from_value::<LegacySessionUpdateNotification>(params.clone()) {
            Ok(legacy) => {
                println!("[DEBUG] Parsed legacy SessionUpdate: {:?}", legacy.update.session_update);
                self.process_legacy_update(&legacy, update_tx, accumulated_text).await;
                return;
            }
            Err(e) => {
                println!("[DEBUG] Failed to parse as legacy SessionUpdate: {}", e);
            }
        }

        warn!("Failed to parse session update notification: {}", params);
        println!("[DEBUG] Raw params that failed to parse: {}", params);

        // Even if parsing failed, try to extract useful info from raw params
        if let Some(update) = params.get("update") {
            // Try to extract file path from locations or rawInput
            if let Some(locations) = update.get("locations") {
                if let Some(first) = locations.as_array().and_then(|arr| arr.first()) {
                    if let Some(path) = first.get("path").and_then(|p| p.as_str()) {
                        self.current_file = Some(path.to_string());
                    }
                }
            }
            if self.current_file.is_none() {
                if let Some(raw_input) = update.get("rawInput") {
                    self.extract_file_path_from_input(raw_input);
                }
            }

            // Send a basic update to frontend
            let update_type = update.get("sessionUpdate")
                .and_then(|s| s.as_str())
                .unwrap_or("unknown");
            let title = update.get("title")
                .and_then(|t| t.as_str())
                .map(String::from);

            let agent_update = AgentUpdate {
                agent_id: self.id,
                update_type: update_type.to_string(),
                message: title.clone(),
                tool: title.map(|t| ToolUpdate { name: t, input: None }),
                progress: None,
                current_file: self.current_file.clone(),
                status: None,
                pending_inputs: None,
            };
            let _ = update_tx.send(agent_update).await;
        }
    }

    /// Process typed SessionUpdate (new ACP spec format)
    async fn process_typed_update(
        &mut self,
        update: &SessionUpdate,
        update_tx: &mpsc::Sender<AgentUpdate>,
        accumulated_text: &mut String,
    ) {
        let update_type = match update {
            SessionUpdate::AgentMessageChunk(_) => "agent_message_chunk",
            SessionUpdate::AgentThoughtChunk(_) => "agent_thought_chunk",
            SessionUpdate::UserMessageChunk(_) => "user_message_chunk",
            SessionUpdate::ToolCall(_) => "tool_call",
            SessionUpdate::ToolCallUpdate(_) => "tool_call_update",
            SessionUpdate::Plan(_) => "plan",
            SessionUpdate::AvailableCommandsUpdate(_) => "available_commands_update",
            SessionUpdate::CurrentModeUpdate(_) => "current_mode_update",
        };
        debug!("Processing typed update: {}", update_type);

        // Check if agent needs user input (ToolCall with status=Pending)
        if update.needs_user_input() {
            self.handle_pending_tool_call(update, update_tx).await;
        }

        // Extract text content from message chunks
        if let Some(text) = update.get_text() {
            accumulated_text.push_str(text);
        }

        // Track current file from tool calls
        match update {
            SessionUpdate::ToolCall(tc) => {
                // Extract file path from locations or rawInput
                if let Some(locations) = &tc.locations {
                    if let Some(first) = locations.first() {
                        self.current_file = Some(first.path.clone());
                    }
                } else if let Some(raw_input) = &tc.raw_input {
                    self.extract_file_path_from_input(raw_input);
                }
            }
            SessionUpdate::ToolCallUpdate(tcu) => {
                if let Some(locations) = &tcu.locations {
                    if let Some(first) = locations.first() {
                        self.current_file = Some(first.path.clone());
                    }
                }
            }
            _ => {}
        }

        // Build and send agent update
        let (message, tool) = match update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                (chunk.content.get_text().map(String::from), None)
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                (chunk.content.get_text().map(String::from), None)
            }
            SessionUpdate::ToolCall(tc) => {
                (Some(tc.title.clone()), Some(ToolUpdate {
                    name: tc.title.clone(),
                    input: tc.raw_input.clone(),
                }))
            }
            SessionUpdate::ToolCallUpdate(tcu) => {
                (tcu.title.clone(), Some(ToolUpdate {
                    name: tcu.title.clone().unwrap_or_default(),
                    input: None,
                }))
            }
            _ => (None, None),
        };

        let agent_update = AgentUpdate {
            agent_id: self.id,
            update_type: update_type.to_string(),
            message,
            tool,
            progress: None,
            current_file: self.current_file.clone(),
            status: None,
            pending_inputs: None,
        };
        let _ = update_tx.send(agent_update).await;
    }

    /// Handle a tool call that needs user approval (status=Pending)
    async fn handle_pending_tool_call(
        &mut self,
        update: &SessionUpdate,
        update_tx: &mpsc::Sender<AgentUpdate>,
    ) {
        let (tool_call_id, title, raw_input) = match update {
            SessionUpdate::ToolCall(tc) if tc.status == ToolCallStatus::Pending => {
                (tc.tool_call_id.clone(), tc.title.clone(), tc.raw_input.clone())
            }
            SessionUpdate::ToolCallUpdate(tcu) if tcu.status == Some(ToolCallStatus::Pending) => {
                (tcu.tool_call_id.clone(), tcu.title.clone().unwrap_or_default(), None)
            }
            _ => return,
        };

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let pending_input = PendingInput {
            id: tool_call_id,
            input_type: PendingInputType::ToolPermission,
            tool_name: Some(title.clone()),
            message: format!("Agent wants to: {}", title),
            timestamp,
        };

        info!("Agent needs permission: {:?}", pending_input);
        self.add_pending_input(pending_input.clone());

        let agent_update = AgentUpdate {
            agent_id: self.id,
            update_type: "pending_input".to_string(),
            message: Some(pending_input.message),
            tool: Some(ToolUpdate {
                name: title,
                input: raw_input,
            }),
            progress: None,
            current_file: self.current_file.clone(),
            status: Some(self.status),
            pending_inputs: Some(self.pending_inputs.clone()),
        };
        let _ = update_tx.send(agent_update).await;
    }

    /// Process legacy string-based SessionUpdate format
    async fn process_legacy_update(
        &mut self,
        notification: &LegacySessionUpdateNotification,
        update_tx: &mpsc::Sender<AgentUpdate>,
        accumulated_text: &mut String,
    ) {
        let update = &notification.update;
        let update_type = &update.session_update;
        debug!("Processing legacy update: {}", update_type);

        // Detect permission/input requests from legacy format
        let is_input_request = update_type.contains("permission")
            || update_type.contains("input_request")
            || update_type.contains("confirmation")
            || update_type == "waiting_for_user";

        if is_input_request {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            let input_type = if update_type.contains("permission") {
                PendingInputType::ToolPermission
            } else if update_type.contains("confirmation") {
                PendingInputType::Confirmation
            } else {
                PendingInputType::UserQuestion
            };

            let message = update
                .content
                .as_ref()
                .and_then(|c| c.text.clone())
                .unwrap_or_else(|| {
                    format!(
                        "Agent needs permission to use: {}",
                        update.name.as_deref().unwrap_or("unknown tool")
                    )
                });

            let pending_input = PendingInput {
                id: update.tool_use_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string()),
                input_type,
                tool_name: update.name.clone(),
                message: message.clone(),
                timestamp,
            };

            info!("Agent needs input (legacy): {:?}", pending_input);
            self.add_pending_input(pending_input);

            let agent_update = AgentUpdate {
                agent_id: self.id,
                update_type: "pending_input".to_string(),
                message: Some(message),
                tool: update.name.clone().map(|name| ToolUpdate {
                    name,
                    input: update.input.clone(),
                }),
                progress: None,
                current_file: self.current_file.clone(),
                status: Some(self.status),
                pending_inputs: Some(self.pending_inputs.clone()),
            };
            let _ = update_tx.send(agent_update).await;
        }

        // Track current file from tool use
        if let Some(ref input) = update.input {
            self.extract_file_path_from_input(input);
        }

        // Extract text from content if present
        let message = update.content.as_ref().and_then(|c| c.text.clone());

        // Accumulate text for the result
        if let Some(ref text) = message {
            accumulated_text.push_str(text);
        }

        let agent_update = AgentUpdate {
            agent_id: self.id,
            update_type: update.session_update.clone(),
            message,
            tool: update.name.clone().map(|name| ToolUpdate {
                name,
                input: update.input.clone(),
            }),
            progress: None,
            current_file: self.current_file.clone(),
            status: None,
            pending_inputs: None,
        };
        let _ = update_tx.send(agent_update).await;
    }

    /// Extract file path from tool input JSON
    fn extract_file_path_from_input(&mut self, input: &Value) {
        if let Some(file) = input.get("file_path") {
            self.current_file = file.as_str().map(String::from);
        } else if let Some(file) = input.get("path") {
            self.current_file = file.as_str().map(String::from);
        }
    }

    /// Handle incoming JSON-RPC requests from the agent (e.g., session/request_permission)
    async fn handle_incoming_request(
        &mut self,
        request_id: i64,
        method: &str,
        params: Option<&Value>,
        update_tx: &mpsc::Sender<AgentUpdate>,
        pending_permissions: &Arc<PendingPermissions>,
    ) -> Result<(), AgentProcessError> {
        match method {
            "session/request_permission" => {
                if let Some(params) = params {
                    self.handle_permission_request(request_id, params, update_tx, pending_permissions).await?;
                }
            }
            _ => {
                warn!("Received unknown request from agent: {}", method);
                // Send error response for unknown methods
                let response = JsonRpcResponse::error(
                    request_id,
                    -32601,
                    format!("Method not found: {}", method),
                );
                let json = serde_json::to_string(&response).unwrap();
                self.codec
                    .write_message(&json)
                    .await
                    .map_err(|e| AgentProcessError::CommunicationError(e.to_string()))?;
            }
        }
        Ok(())
    }

    /// Handle session/request_permission request from agent
    async fn handle_permission_request(
        &mut self,
        request_id: i64,
        params: &Value,
        update_tx: &mpsc::Sender<AgentUpdate>,
        pending_permissions: &Arc<PendingPermissions>,
    ) -> Result<(), AgentProcessError> {
        let request: RequestPermissionRequest = serde_json::from_value(params.clone())
            .map_err(|e| AgentProcessError::CommunicationError(format!("Invalid permission request: {}", e)))?;

        info!("Agent requesting permission for: {}", request.tool_call.title.as_deref().unwrap_or("unknown"));

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let input_id = format!("perm_req_{}", request_id);

        // Store the request_id so we can respond later
        let pending_input = PendingInput {
            id: input_id.clone(),
            input_type: PendingInputType::ToolPermission,
            tool_name: request.tool_call.title.clone(),
            message: format!(
                "Permission requested: {}",
                request.tool_call.title.as_deref().unwrap_or("unknown tool")
            ),
            timestamp,
        };

        self.add_pending_input(pending_input.clone());

        // Create a channel to wait for user response
        let (response_tx, response_rx) = oneshot::channel::<PermissionUserResponse>();

        // Store the pending permission in shared storage (avoids deadlock by not requiring agent lock)
        pending_permissions.store(self.id, &input_id, response_tx);

        // Notify frontend about the permission request with available options
        let agent_update = AgentUpdate {
            agent_id: self.id,
            update_type: "permission_request".to_string(),
            message: Some(pending_input.message),
            tool: request.tool_call.title.clone().map(|name| ToolUpdate {
                name,
                input: None,
            }),
            progress: None,
            current_file: self.current_file.clone(),
            status: Some(self.status),
            pending_inputs: Some(self.pending_inputs.clone()),
        };
        let _ = update_tx.send(agent_update).await;

        info!("Waiting for user response for permission request {}", input_id);

        // Wait for user response via the channel
        let user_response = response_rx.await.map_err(|_| {
            AgentProcessError::CommunicationError("Permission request channel closed".to_string())
        })?;

        info!("Received user response: approved={}, option_id={:?}", user_response.approved, user_response.option_id);

        // Build the response based on user's choice
        let response = if user_response.approved {
            // User approved - use the selected option_id or find the first "allow" option
            let option_id = user_response.option_id.unwrap_or_else(|| {
                request.options
                    .iter()
                    .find(|o| matches!(o.kind, crate::acp::PermissionOptionKind::AllowOnce | crate::acp::PermissionOptionKind::AllowAlways))
                    .map(|o| o.option_id.clone())
                    .unwrap_or_else(|| request.options.first().map(|o| o.option_id.clone()).unwrap_or_default())
            });
            println!("[DEBUG] Sending permission APPROVED with optionId: {}", option_id);
            RequestPermissionResponse::selected(option_id)
        } else {
            // User denied - find the first "reject" option or use "cancelled"
            let reject_option = request.options
                .iter()
                .find(|o| matches!(o.kind, crate::acp::PermissionOptionKind::RejectOnce | crate::acp::PermissionOptionKind::RejectAlways));

            if let Some(reject) = reject_option {
                println!("[DEBUG] Sending permission REJECTED with optionId: {}", reject.option_id);
                RequestPermissionResponse::selected(reject.option_id.clone())
            } else {
                println!("[DEBUG] Sending permission CANCELLED");
                RequestPermissionResponse::cancelled()
            }
        };

        let rpc_response = JsonRpcResponse::success(
            request_id,
            serde_json::to_value(&response).unwrap(),
        );

        let json = serde_json::to_string(&rpc_response).unwrap();
        info!("Sending permission response: {}", json);
        self.codec
            .write_message(&json)
            .await
            .map_err(|e| AgentProcessError::CommunicationError(e.to_string()))?;

        // Clear the pending input since we responded
        self.clear_pending_input(&input_id);

        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), AgentProcessError> {
        self.status = AgentStatus::Stopped;
        self.child
            .kill()
            .await
            .map_err(|e| AgentProcessError::StopFailed(e.to_string()))?;
        Ok(())
    }

    pub fn info(&self) -> AgentInfo {
        AgentInfo {
            id: self.id,
            name: self.name.clone(),
            status: self.status,
            session_id: self.session_id.clone(),
            working_directory: self.working_directory.clone(),
            current_file: self.current_file.clone(),
            progress: self.progress,
            tokens_used: self.tokens_used,
            token_limit: 100000,
            pending_inputs: self.pending_inputs.clone(),
        }
    }

    /// Add a pending input request
    pub fn add_pending_input(&mut self, input: PendingInput) {
        self.pending_inputs.push(input);
        self.status = AgentStatus::Paused; // Agent is waiting for input
    }

    /// Clear a pending input by ID
    pub fn clear_pending_input(&mut self, input_id: &str) {
        self.pending_inputs.retain(|i| i.id != input_id);
        if self.pending_inputs.is_empty() {
            self.status = AgentStatus::Idle;
        }
    }

    /// Check if agent has pending inputs
    pub fn has_pending_inputs(&self) -> bool {
        !self.pending_inputs.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentUpdate {
    pub agent_id: Uuid,
    pub update_type: String,
    pub message: Option<String>,
    pub tool: Option<ToolUpdate>,
    pub progress: Option<f64>,
    pub current_file: Option<String>,
    pub status: Option<AgentStatus>,
    pub pending_inputs: Option<Vec<PendingInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolUpdate {
    pub name: String,
    pub input: Option<Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentProcessError {
    #[error("Failed to spawn process: {0}")]
    SpawnFailed(String),
    #[error("Stdin unavailable")]
    StdinUnavailable,
    #[error("Stdout unavailable")]
    StdoutUnavailable,
    #[error("Communication error: {0}")]
    CommunicationError(String),
    #[error("Initialize failed: {0}")]
    InitializeFailed(String),
    #[error("Session create failed: {0}")]
    SessionCreateFailed(String),
    #[error("No active session")]
    NoSession,
    #[error("Prompt failed: {0}")]
    PromptFailed(String),
    #[error("Stop failed: {0}")]
    StopFailed(String),
}
