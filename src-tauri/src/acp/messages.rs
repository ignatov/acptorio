use serde::{Deserialize, Serialize};
use serde_json::Value;

// ============================================================================
// Initialize
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: i32,
    #[serde(rename = "clientCapabilities", skip_serializing_if = "Option::is_none")]
    pub client_capabilities: Option<Value>,
    #[serde(rename = "clientInfo", skip_serializing_if = "Option::is_none")]
    pub client_info: Option<ClientInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeResult {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: i32,
    #[serde(rename = "agentCapabilities")]
    pub agent_capabilities: Option<Value>,
    #[serde(rename = "agentInfo")]
    pub agent_info: Option<AgentInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    pub title: Option<String>,
    pub version: String,
}

impl InitializeParams {
    pub fn new() -> Self {
        Self {
            protocol_version: 1,
            client_capabilities: Some(serde_json::json!({
                "fs": {
                    "readTextFile": true,
                    "writeTextFile": true
                }
            })),
            client_info: Some(ClientInfo {
                name: "ACPtorio".to_string(),
                version: "0.1.0".to_string(),
            }),
        }
    }
}

impl Default for InitializeParams {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Authentication
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthMethod {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthStartParams {
    #[serde(rename = "authMethodId")]
    pub auth_method_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthStartResult {
    /// URL to open in browser for OAuth flow
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Instructions to display to user
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Whether auth completed immediately (e.g., API key already set)
    #[serde(default)]
    pub completed: bool,
}

// ============================================================================
// Session Management
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionNewParams {
    pub cwd: String,
    #[serde(rename = "mcpServers")]
    pub mcp_servers: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionNewResult {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<Value>,
}

// ============================================================================
// Prompt
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { data: String, mime_type: String },
}

impl ContentBlock {
    pub fn text(text: &str) -> Self {
        ContentBlock::Text {
            text: text.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

impl PromptContent {
    pub fn text(text: &str) -> Self {
        Self {
            content_type: "text".to_string(),
            text: text.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPromptParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub prompt: Vec<PromptContent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPromptResult {
    #[serde(rename = "stopReason")]
    pub stop_reason: StopReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    Completed,
    Cancelled,
    MaxTokens,
    ToolCalls,
    #[serde(other)]
    Unknown,
}

// ============================================================================
// Session Update (Notification from Agent)
// ============================================================================

/// Notification params for session/update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionUpdateNotification {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub update: SessionUpdate,
}

/// Different types of session updates - matches ACP spec
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionUpdate {
    /// A chunk of the user's message being streamed
    UserMessageChunk(ContentChunk),

    /// A chunk of the agent's response being streamed
    AgentMessageChunk(ContentChunk),

    /// A chunk of the agent's internal reasoning being streamed
    AgentThoughtChunk(ContentChunk),

    /// Notification that a new tool call has been initiated
    ToolCall(ToolCall),

    /// Update on the status or results of a tool call
    ToolCallUpdate(ToolCallUpdate),

    /// The agent's execution plan for complex tasks
    Plan(Plan),

    /// Available commands are ready or have changed
    AvailableCommandsUpdate(AvailableCommandsUpdate),

    /// The current mode of the session has changed
    CurrentModeUpdate(CurrentModeUpdate),
}

impl SessionUpdate {
    /// Check if this update indicates the agent needs user input
    pub fn needs_user_input(&self) -> bool {
        match self {
            SessionUpdate::ToolCall(tc) => tc.status == ToolCallStatus::Pending,
            SessionUpdate::ToolCallUpdate(tcu) => tcu.status == Some(ToolCallStatus::Pending),
            _ => false,
        }
    }

    /// Get text content if this is a message chunk
    pub fn get_text(&self) -> Option<&str> {
        match self {
            SessionUpdate::AgentMessageChunk(chunk) => chunk.content.get_text(),
            SessionUpdate::AgentThoughtChunk(chunk) => chunk.content.get_text(),
            SessionUpdate::UserMessageChunk(chunk) => chunk.content.get_text(),
            _ => None,
        }
    }

    /// Get tool call info if this is a tool-related update
    pub fn get_tool_info(&self) -> Option<(&str, &str)> {
        match self {
            SessionUpdate::ToolCall(tc) => Some((&tc.tool_call_id, &tc.title)),
            SessionUpdate::ToolCallUpdate(tcu) => {
                Some((&tcu.tool_call_id, tcu.title.as_deref().unwrap_or("")))
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentChunk {
    pub content: ChunkContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChunkContent {
    Text { text: String },
}

impl ChunkContent {
    pub fn get_text(&self) -> Option<&str> {
        match self {
            ChunkContent::Text { text } => Some(text),
        }
    }
}

// ============================================================================
// Tool Call Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// Unique identifier for this tool call
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,

    /// Human-readable title describing what the tool is doing
    pub title: String,

    /// The category of tool being invoked
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,

    /// Current execution status
    pub status: ToolCallStatus,

    /// Content produced by the tool call
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<ContentBlock>>,

    /// File locations affected by this tool call
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locations: Option<Vec<FileLocation>>,

    /// Raw input parameters
    #[serde(rename = "rawInput", skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<Value>,

    /// Raw output from the tool
    #[serde(rename = "rawOutput", skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallUpdate {
    /// The tool call being updated
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,

    /// Updated title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    /// Updated status
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ToolCallStatus>,

    /// Updated content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<ContentBlock>>,

    /// Updated locations
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locations: Option<Vec<FileLocation>>,

    /// Updated raw output
    #[serde(rename = "rawOutput", skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    /// Awaiting approval or input streaming
    Pending,
    /// Currently executing
    InProgress,
    /// Completed successfully
    Completed,
    /// Failed with an error
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileLocation {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<FileRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRange {
    pub start: Position,
    pub end: Position,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

// ============================================================================
// Plan Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub entries: Vec<PlanEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanEntry {
    pub id: String,
    pub title: String,
    pub status: PlanEntryStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<PlanEntryPriority>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanEntryStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanEntryPriority {
    High,
    Medium,
    Low,
}

// ============================================================================
// Commands & Mode
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableCommandsUpdate {
    pub commands: Vec<Command>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentModeUpdate {
    pub mode: String,
}

// ============================================================================
// Permission Request (Request from Agent to Client)
// ============================================================================

/// Request from agent asking for permission to execute a tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestPermissionRequest {
    #[serde(rename = "sessionId")]
    pub session_id: String,

    /// The tool call that needs permission
    #[serde(rename = "toolCall")]
    pub tool_call: ToolCallUpdate,

    /// Options to present to the user
    pub options: Vec<PermissionOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionOption {
    #[serde(rename = "optionId")]
    pub option_id: String,
    pub name: String,
    pub kind: PermissionOptionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}

/// Response to session/request_permission
/// ACP format: {"outcome": {"outcome": "selected", "optionId": "..."}}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestPermissionResponse {
    pub outcome: PermissionOutcomeValue,
}

/// The outcome value containing the decision
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum PermissionOutcomeValue {
    Selected {
        #[serde(rename = "optionId")]
        option_id: String,
    },
    Cancelled,
}

impl RequestPermissionResponse {
    pub fn selected(option_id: String) -> Self {
        Self {
            outcome: PermissionOutcomeValue::Selected { option_id },
        }
    }

    pub fn cancelled() -> Self {
        Self {
            outcome: PermissionOutcomeValue::Cancelled,
        }
    }
}

// Keep old type for backward compatibility in tests
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyRequestPermissionResponse {
    pub outcome: PermissionOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PermissionOutcome {
    SelectedPermissionOutcome { selected_option: PermissionOptionKind },
}

// ============================================================================
// Legacy types for backward compatibility
// ============================================================================

/// Legacy session update format (string-based type)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacySessionUpdate {
    #[serde(rename = "sessionUpdate")]
    pub session_update: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<LegacyUpdateContent>,
    #[serde(rename = "toolUseId", skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyUpdateContent {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Legacy notification format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacySessionUpdateNotification {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub update: LegacySessionUpdate,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_params_serialization() {
        let params = InitializeParams::new();
        let json = serde_json::to_string(&params).unwrap();

        assert!(json.contains("\"protocolVersion\":1"));
        assert!(json.contains("\"clientInfo\""));
        assert!(!json.contains("protocol_version"));
    }

    #[test]
    fn test_session_new_params_serialization() {
        let params = SessionNewParams {
            cwd: "/test/path".to_string(),
            mcp_servers: vec![],
        };
        let json = serde_json::to_string(&params).unwrap();

        assert!(json.contains("\"cwd\":\"/test/path\""));
        assert!(json.contains("\"mcpServers\":[]"));
    }

    #[test]
    fn test_session_prompt_params_serialization() {
        let params = SessionPromptParams {
            session_id: "test-session".to_string(),
            prompt: vec![PromptContent::text("Hello")],
        };
        let json = serde_json::to_string(&params).unwrap();

        assert!(json.contains("\"sessionId\":\"test-session\""));
        assert!(json.contains("\"prompt\":["));
        assert!(json.contains("\"type\":\"text\""));
        assert!(json.contains("\"text\":\"Hello\""));
    }

    #[test]
    fn test_agent_message_chunk_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "type": "agent_message_chunk",
                "content": {
                    "type": "text",
                    "text": "Hello"
                }
            }
        }"#;

        let notification: SessionUpdateNotification = serde_json::from_str(json).unwrap();
        assert_eq!(notification.session_id, "test-session");

        if let SessionUpdate::AgentMessageChunk(chunk) = notification.update {
            assert_eq!(chunk.content.get_text(), Some("Hello"));
        } else {
            panic!("Expected AgentMessageChunk");
        }
    }

    #[test]
    fn test_tool_call_pending_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "type": "tool_call",
                "toolCallId": "tool-123",
                "title": "Reading file.rs",
                "status": "pending",
                "rawInput": {"file_path": "/test/file.rs"}
            }
        }"#;

        let notification: SessionUpdateNotification = serde_json::from_str(json).unwrap();

        if let SessionUpdate::ToolCall(tc) = &notification.update {
            assert_eq!(tc.tool_call_id, "tool-123");
            assert_eq!(tc.title, "Reading file.rs");
            assert_eq!(tc.status, ToolCallStatus::Pending);
            assert!(notification.update.needs_user_input());
        } else {
            panic!("Expected ToolCall");
        }
    }

    #[test]
    fn test_tool_call_in_progress_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "type": "tool_call",
                "toolCallId": "tool-123",
                "title": "Reading file.rs",
                "status": "in_progress"
            }
        }"#;

        let notification: SessionUpdateNotification = serde_json::from_str(json).unwrap();

        if let SessionUpdate::ToolCall(tc) = &notification.update {
            assert_eq!(tc.status, ToolCallStatus::InProgress);
            assert!(!notification.update.needs_user_input());
        } else {
            panic!("Expected ToolCall");
        }
    }

    #[test]
    fn test_tool_call_completed_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "type": "tool_call",
                "toolCallId": "tool-123",
                "title": "Read file.rs",
                "status": "completed",
                "rawOutput": {"content": "file contents..."}
            }
        }"#;

        let notification: SessionUpdateNotification = serde_json::from_str(json).unwrap();

        if let SessionUpdate::ToolCall(tc) = notification.update {
            assert_eq!(tc.status, ToolCallStatus::Completed);
            assert!(tc.raw_output.is_some());
        } else {
            panic!("Expected ToolCall");
        }
    }

    #[test]
    fn test_tool_call_update_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "type": "tool_call_update",
                "toolCallId": "tool-123",
                "status": "completed",
                "rawOutput": {"result": "success"}
            }
        }"#;

        let notification: SessionUpdateNotification = serde_json::from_str(json).unwrap();

        if let SessionUpdate::ToolCallUpdate(tcu) = notification.update {
            assert_eq!(tcu.tool_call_id, "tool-123");
            assert_eq!(tcu.status, Some(ToolCallStatus::Completed));
        } else {
            panic!("Expected ToolCallUpdate");
        }
    }

    #[test]
    fn test_plan_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "type": "plan",
                "entries": [
                    {"id": "1", "title": "Analyze code", "status": "completed"},
                    {"id": "2", "title": "Make changes", "status": "in_progress"},
                    {"id": "3", "title": "Run tests", "status": "pending"}
                ]
            }
        }"#;

        let notification: SessionUpdateNotification = serde_json::from_str(json).unwrap();

        if let SessionUpdate::Plan(plan) = notification.update {
            assert_eq!(plan.entries.len(), 3);
            assert_eq!(plan.entries[0].status, PlanEntryStatus::Completed);
            assert_eq!(plan.entries[1].status, PlanEntryStatus::InProgress);
            assert_eq!(plan.entries[2].status, PlanEntryStatus::Pending);
        } else {
            panic!("Expected Plan");
        }
    }

    #[test]
    fn test_request_permission_request_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "toolCall": {
                "toolCallId": "tool-123",
                "title": "Write to file.rs",
                "status": "pending"
            },
            "options": [
                {"optionId": "opt-1", "name": "Allow once", "kind": "allow_once"},
                {"optionId": "opt-2", "name": "Always allow", "kind": "allow_always"},
                {"optionId": "opt-3", "name": "Deny", "kind": "reject_once"}
            ]
        }"#;

        let request: RequestPermissionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.session_id, "test-session");
        assert_eq!(request.tool_call.tool_call_id, "tool-123");
        assert_eq!(request.options.len(), 3);
        assert_eq!(request.options[0].kind, PermissionOptionKind::AllowOnce);
        assert_eq!(request.options[0].option_id, "opt-1");
        assert_eq!(request.options[0].name, "Allow once");
    }

    #[test]
    fn test_permission_response_serialization() {
        let response = RequestPermissionResponse::selected("opt-allow-once".to_string());
        let json = serde_json::to_string(&response).unwrap();

        // New format: {"outcome":{"outcome":"selected","optionId":"..."}}
        assert!(json.contains("\"outcome\":{"));
        assert!(json.contains("\"outcome\":\"selected\""));
        assert!(json.contains("\"optionId\":\"opt-allow-once\""));

        // Test cancelled response
        let cancelled = RequestPermissionResponse::cancelled();
        let json = serde_json::to_string(&cancelled).unwrap();
        assert!(json.contains("\"outcome\":\"cancelled\""));
    }

    #[test]
    fn test_stop_reason_deserialization() {
        let json = r#"{"stopReason": "completed"}"#;
        let result: SessionPromptResult = serde_json::from_str(json).unwrap();
        assert!(matches!(result.stop_reason, StopReason::Completed));

        let json = r#"{"stopReason": "max_tokens"}"#;
        let result: SessionPromptResult = serde_json::from_str(json).unwrap();
        assert!(matches!(result.stop_reason, StopReason::MaxTokens));

        let json = r#"{"stopReason": "some_unknown_value"}"#;
        let result: SessionPromptResult = serde_json::from_str(json).unwrap();
        assert!(matches!(result.stop_reason, StopReason::Unknown));
    }

    #[test]
    fn test_legacy_session_update_deserialization() {
        // Test backward compatibility with string-based update type
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {
                    "type": "text",
                    "text": "Hello"
                }
            }
        }"#;

        let notification: LegacySessionUpdateNotification = serde_json::from_str(json).unwrap();
        assert_eq!(notification.session_id, "test-session");
        assert_eq!(notification.update.session_update, "agent_message_chunk");
        assert_eq!(
            notification.update.content.as_ref().unwrap().text,
            Some("Hello".to_string())
        );
    }

    #[test]
    fn test_legacy_tool_update_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "sessionUpdate": "tool_use_start",
                "toolUseId": "tool-123",
                "name": "Read",
                "input": {"file_path": "/test/file.rs"}
            }
        }"#;

        let notification: LegacySessionUpdateNotification = serde_json::from_str(json).unwrap();
        assert_eq!(notification.update.session_update, "tool_use_start");
        assert_eq!(notification.update.tool_use_id, Some("tool-123".to_string()));
        assert_eq!(notification.update.name, Some("Read".to_string()));
    }

    #[test]
    fn test_current_mode_update_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "type": "current_mode_update",
                "mode": "architect"
            }
        }"#;

        let notification: SessionUpdateNotification = serde_json::from_str(json).unwrap();

        if let SessionUpdate::CurrentModeUpdate(update) = notification.update {
            assert_eq!(update.mode, "architect");
        } else {
            panic!("Expected CurrentModeUpdate");
        }
    }

    #[test]
    fn test_available_commands_update_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "type": "available_commands_update",
                "commands": [
                    {"name": "/help", "description": "Show help"},
                    {"name": "/clear", "description": "Clear context"}
                ]
            }
        }"#;

        let notification: SessionUpdateNotification = serde_json::from_str(json).unwrap();

        if let SessionUpdate::AvailableCommandsUpdate(update) = notification.update {
            assert_eq!(update.commands.len(), 2);
            assert_eq!(update.commands[0].name, "/help");
        } else {
            panic!("Expected AvailableCommandsUpdate");
        }
    }

    #[test]
    fn test_file_location_deserialization() {
        let json = r#"{
            "sessionId": "test-session",
            "update": {
                "type": "tool_call",
                "toolCallId": "tool-123",
                "title": "Edit file",
                "status": "in_progress",
                "locations": [
                    {
                        "path": "/test/file.rs",
                        "range": {
                            "start": {"line": 10, "character": 0},
                            "end": {"line": 20, "character": 0}
                        }
                    }
                ]
            }
        }"#;

        let notification: SessionUpdateNotification = serde_json::from_str(json).unwrap();

        if let SessionUpdate::ToolCall(tc) = notification.update {
            let locations = tc.locations.unwrap();
            assert_eq!(locations.len(), 1);
            assert_eq!(locations[0].path, "/test/file.rs");
            let range = locations[0].range.as_ref().unwrap();
            assert_eq!(range.start.line, 10);
            assert_eq!(range.end.line, 20);
        } else {
            panic!("Expected ToolCall");
        }
    }

    #[test]
    fn test_tool_call_needs_user_input() {
        // Pending status should need input
        let json = r#"{
            "sessionId": "s",
            "update": {"type": "tool_call", "toolCallId": "1", "title": "t", "status": "pending"}
        }"#;
        let n: SessionUpdateNotification = serde_json::from_str(json).unwrap();
        assert!(n.update.needs_user_input(), "Pending ToolCall should need input");

        // InProgress should not need input
        let json = r#"{
            "sessionId": "s",
            "update": {"type": "tool_call", "toolCallId": "1", "title": "t", "status": "in_progress"}
        }"#;
        let n: SessionUpdateNotification = serde_json::from_str(json).unwrap();
        assert!(!n.update.needs_user_input(), "InProgress ToolCall should not need input");

        // Completed should not need input
        let json = r#"{
            "sessionId": "s",
            "update": {"type": "tool_call", "toolCallId": "1", "title": "t", "status": "completed"}
        }"#;
        let n: SessionUpdateNotification = serde_json::from_str(json).unwrap();
        assert!(!n.update.needs_user_input(), "Completed ToolCall should not need input");

        // AgentMessageChunk should not need input
        let json = r#"{
            "sessionId": "s",
            "update": {"type": "agent_message_chunk", "content": {"type": "text", "text": "hi"}}
        }"#;
        let n: SessionUpdateNotification = serde_json::from_str(json).unwrap();
        assert!(!n.update.needs_user_input(), "AgentMessageChunk should not need input");
    }

    #[test]
    fn test_full_permission_request_flow() {
        // This mimics a complete session/request_permission request from an agent
        let request_json = r#"{
            "sessionId": "session-abc",
            "toolCall": {
                "toolCallId": "tc-456",
                "title": "Write to /etc/passwd",
                "status": "pending"
            },
            "options": [
                {"optionId": "allow-once", "name": "Allow this once", "kind": "allow_once", "description": "Permit this action one time"},
                {"optionId": "allow-always", "name": "Always allow", "kind": "allow_always", "description": "Never ask again for this tool"},
                {"optionId": "reject-once", "name": "Deny", "kind": "reject_once"},
                {"optionId": "reject-always", "name": "Always deny", "kind": "reject_always"}
            ]
        }"#;

        let request: RequestPermissionRequest = serde_json::from_str(request_json).unwrap();
        assert_eq!(request.session_id, "session-abc");
        assert_eq!(request.tool_call.tool_call_id, "tc-456");
        assert_eq!(request.tool_call.title, Some("Write to /etc/passwd".to_string()));
        assert_eq!(request.options.len(), 4);
        assert_eq!(request.options[0].kind, PermissionOptionKind::AllowOnce);
        assert_eq!(request.options[0].option_id, "allow-once");
        assert_eq!(request.options[1].kind, PermissionOptionKind::AllowAlways);
        assert_eq!(request.options[2].kind, PermissionOptionKind::RejectOnce);
        assert_eq!(request.options[3].kind, PermissionOptionKind::RejectAlways);
        assert_eq!(request.options[0].description, Some("Permit this action one time".to_string()));
        assert!(request.options[2].description.is_none());

        // Now test creating a response - select the first allow option
        let response = RequestPermissionResponse::selected(request.options[0].option_id.clone());

        let response_json = serde_json::to_string(&response).unwrap();
        assert!(response_json.contains("\"outcome\":\"selected\""));
        assert!(response_json.contains("\"optionId\":\"allow-once\""));

        // Verify round-trip
        let parsed_response: RequestPermissionResponse = serde_json::from_str(&response_json).unwrap();
        match parsed_response.outcome {
            PermissionOutcomeValue::Selected { option_id } => {
                assert_eq!(option_id, "allow-once");
            }
            _ => panic!("Expected Selected response"),
        }
    }

    #[test]
    fn test_all_permission_option_kinds() {
        let kinds = [
            (PermissionOptionKind::AllowOnce, "allow_once"),
            (PermissionOptionKind::AllowAlways, "allow_always"),
            (PermissionOptionKind::RejectOnce, "reject_once"),
            (PermissionOptionKind::RejectAlways, "reject_always"),
        ];

        for (i, (kind, expected_str)) in kinds.iter().enumerate() {
            let option = PermissionOption {
                option_id: format!("opt-{}", i),
                name: "test".to_string(),
                kind: *kind,
                description: None,
            };
            let json = serde_json::to_string(&option).unwrap();
            assert!(json.contains(expected_str), "Expected {} in JSON: {}", expected_str, json);

            // Round-trip
            let parsed: PermissionOption = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed.kind, *kind);
            assert_eq!(parsed.option_id, format!("opt-{}", i));
        }
    }

    #[test]
    fn test_session_update_get_text() {
        let json = r#"{
            "sessionId": "s",
            "update": {"type": "agent_message_chunk", "content": {"type": "text", "text": "Hello world"}}
        }"#;
        let n: SessionUpdateNotification = serde_json::from_str(json).unwrap();
        assert_eq!(n.update.get_text(), Some("Hello world"));

        let json = r#"{
            "sessionId": "s",
            "update": {"type": "tool_call", "toolCallId": "1", "title": "t", "status": "pending"}
        }"#;
        let n: SessionUpdateNotification = serde_json::from_str(json).unwrap();
        assert_eq!(n.update.get_text(), None);
    }

    #[test]
    fn test_plan_entry_statuses() {
        let json = r#"{
            "sessionId": "s",
            "update": {
                "type": "plan",
                "entries": [
                    {"id": "1", "title": "Task 1", "status": "pending", "priority": "high"},
                    {"id": "2", "title": "Task 2", "status": "in_progress", "priority": "medium"},
                    {"id": "3", "title": "Task 3", "status": "completed", "priority": "low"}
                ]
            }
        }"#;

        let n: SessionUpdateNotification = serde_json::from_str(json).unwrap();
        if let SessionUpdate::Plan(plan) = n.update {
            assert_eq!(plan.entries[0].status, PlanEntryStatus::Pending);
            assert_eq!(plan.entries[0].priority, Some(PlanEntryPriority::High));
            assert_eq!(plan.entries[1].status, PlanEntryStatus::InProgress);
            assert_eq!(plan.entries[1].priority, Some(PlanEntryPriority::Medium));
            assert_eq!(plan.entries[2].status, PlanEntryStatus::Completed);
            assert_eq!(plan.entries[2].priority, Some(PlanEntryPriority::Low));
        } else {
            panic!("Expected Plan");
        }
    }
}
