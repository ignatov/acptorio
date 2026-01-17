//! Message processing logic for ACP protocol messages.
//!
//! This module contains the core logic for processing incoming ACP messages
//! and generating appropriate responses and updates. It's designed to be
//! testable independently of the actual process communication.

use crate::acp::{
    JsonRpcResponse, LegacySessionUpdateNotification, PermissionOptionKind,
    RequestPermissionRequest, RequestPermissionResponse, SessionUpdate, SessionUpdateNotification,
    ToolCallStatus,
};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

// Re-use types from process module to avoid duplication
pub use super::process::{AgentUpdate, PendingInput, PendingInputType, ToolUpdate};

/// Result of processing a session update
#[derive(Debug, Clone, Default)]
pub struct ProcessingResult {
    /// Updates to send to the frontend
    pub updates: Vec<AgentUpdate>,
    /// Pending inputs detected (need user action)
    pub pending_inputs: Vec<PendingInput>,
    /// Text to accumulate from message chunks
    pub accumulated_text: String,
    /// Current file being worked on (if detected)
    pub current_file: Option<String>,
}

/// Result of processing a permission request
#[derive(Debug, Clone)]
pub struct PermissionProcessingResult {
    /// Update to send to frontend
    pub update: AgentUpdate,
    /// Pending input to track
    pub pending_input: PendingInput,
    /// Response to send back to agent
    pub response: JsonRpcResponse,
}

/// Process a session/update notification and return the results
pub fn process_session_update(
    agent_id: Uuid,
    params: &Value,
    current_file: Option<String>,
) -> ProcessingResult {
    // Try new typed format first
    if let Ok(notification) = serde_json::from_value::<SessionUpdateNotification>(params.clone()) {
        return process_typed_session_update(agent_id, &notification.update, current_file);
    }

    // Fall back to legacy format
    if let Ok(legacy) = serde_json::from_value::<LegacySessionUpdateNotification>(params.clone()) {
        return process_legacy_session_update(agent_id, &legacy, current_file);
    }

    // Failed to parse - return empty result
    ProcessingResult::default()
}

/// Process a typed SessionUpdate (new ACP spec format)
pub fn process_typed_session_update(
    agent_id: Uuid,
    update: &SessionUpdate,
    mut current_file: Option<String>,
) -> ProcessingResult {
    let mut result = ProcessingResult::default();
    result.current_file = current_file.clone();

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

    // Check if agent needs user input (ToolCall with status=Pending)
    if update.needs_user_input() {
        if let Some((pending_input, pending_update)) =
            create_pending_tool_call(agent_id, update, current_file.clone())
        {
            result.pending_inputs.push(pending_input);
            result.updates.push(pending_update);
        }
    }

    // Extract text content from message chunks
    if let Some(text) = update.get_text() {
        result.accumulated_text = text.to_string();
    }

    // Track current file from tool calls
    match update {
        SessionUpdate::ToolCall(tc) => {
            if let Some(locations) = &tc.locations {
                if let Some(first) = locations.first() {
                    current_file = Some(first.path.clone());
                    result.current_file = current_file.clone();
                }
            } else if let Some(raw_input) = &tc.raw_input {
                if let Some(path) = extract_file_path(raw_input) {
                    current_file = Some(path);
                    result.current_file = current_file.clone();
                }
            }
        }
        SessionUpdate::ToolCallUpdate(tcu) => {
            if let Some(locations) = &tcu.locations {
                if let Some(first) = locations.first() {
                    current_file = Some(first.path.clone());
                    result.current_file = current_file.clone();
                }
            }
        }
        _ => {}
    }

    // Build main agent update
    let (message, tool) = match update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            (chunk.content.get_text().map(String::from), None)
        }
        SessionUpdate::AgentThoughtChunk(chunk) => {
            (chunk.content.get_text().map(String::from), None)
        }
        SessionUpdate::ToolCall(tc) => (
            Some(tc.title.clone()),
            Some(ToolUpdate {
                name: tc.title.clone(),
                input: tc.raw_input.clone(),
            }),
        ),
        SessionUpdate::ToolCallUpdate(tcu) => (
            tcu.title.clone(),
            Some(ToolUpdate {
                name: tcu.title.clone().unwrap_or_default(),
                input: None,
            }),
        ),
        SessionUpdate::Plan(plan) => {
            let plan_summary = plan
                .entries
                .iter()
                .map(|e| format!("{}: {:?}", e.title, e.status))
                .collect::<Vec<_>>()
                .join(", ");
            (Some(plan_summary), None)
        }
        SessionUpdate::CurrentModeUpdate(mode) => (Some(format!("Mode: {}", mode.mode)), None),
        SessionUpdate::AvailableCommandsUpdate(cmds) => {
            let cmd_list = cmds
                .commands
                .iter()
                .map(|c| c.name.clone())
                .collect::<Vec<_>>()
                .join(", ");
            (Some(format!("Commands: {}", cmd_list)), None)
        }
        _ => (None, None),
    };

    let agent_update = AgentUpdate {
        agent_id,
        update_type: update_type.to_string(),
        message,
        tool,
        progress: None,
        current_file: result.current_file.clone(),
        status: None,
        pending_inputs: None,
    };
    result.updates.push(agent_update);

    result
}

/// Create pending input and update for a tool call needing approval
fn create_pending_tool_call(
    agent_id: Uuid,
    update: &SessionUpdate,
    current_file: Option<String>,
) -> Option<(PendingInput, AgentUpdate)> {
    let (tool_call_id, title, raw_input) = match update {
        SessionUpdate::ToolCall(tc) if tc.status == ToolCallStatus::Pending => {
            (tc.tool_call_id.clone(), tc.title.clone(), tc.raw_input.clone())
        }
        SessionUpdate::ToolCallUpdate(tcu) if tcu.status == Some(ToolCallStatus::Pending) => (
            tcu.tool_call_id.clone(),
            tcu.title.clone().unwrap_or_default(),
            None,
        ),
        _ => return None,
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

    let agent_update = AgentUpdate {
        agent_id,
        update_type: "pending_input".to_string(),
        message: Some(pending_input.message.clone()),
        tool: Some(ToolUpdate {
            name: title,
            input: raw_input,
        }),
        progress: None,
        current_file,
        status: None,
        pending_inputs: None,
    };

    Some((pending_input, agent_update))
}

/// Process a legacy string-based session update
pub fn process_legacy_session_update(
    agent_id: Uuid,
    notification: &LegacySessionUpdateNotification,
    mut current_file: Option<String>,
) -> ProcessingResult {
    let mut result = ProcessingResult::default();
    result.current_file = current_file.clone();

    let update = &notification.update;
    let update_type = &update.session_update;

    // Detect permission/input requests
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
            id: update
                .tool_use_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            input_type,
            tool_name: update.name.clone(),
            message: message.clone(),
            timestamp,
        };

        result.pending_inputs.push(pending_input);

        let pending_update = AgentUpdate {
            agent_id,
            update_type: "pending_input".to_string(),
            message: Some(message),
            tool: update.name.clone().map(|name| ToolUpdate {
                name,
                input: update.input.clone(),
            }),
            progress: None,
            current_file: current_file.clone(),
            status: None,
            pending_inputs: None,
        };
        result.updates.push(pending_update);
    }

    // Track current file from tool use
    if let Some(ref input) = update.input {
        if let Some(path) = extract_file_path(input) {
            current_file = Some(path);
            result.current_file = current_file.clone();
        }
    }

    // Extract text from content
    let message = update.content.as_ref().and_then(|c| c.text.clone());
    if let Some(ref text) = message {
        result.accumulated_text = text.clone();
    }

    // Build main agent update
    let agent_update = AgentUpdate {
        agent_id,
        update_type: update.session_update.clone(),
        message,
        tool: update.name.clone().map(|name| ToolUpdate {
            name,
            input: update.input.clone(),
        }),
        progress: None,
        current_file: result.current_file.clone(),
        status: None,
        pending_inputs: None,
    };
    result.updates.push(agent_update);

    result
}

/// Extract file path from tool input JSON
pub fn extract_file_path(input: &Value) -> Option<String> {
    input
        .get("file_path")
        .or_else(|| input.get("path"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// Process a session/request_permission request from the agent
pub fn process_permission_request(
    agent_id: Uuid,
    request_id: i64,
    params: &Value,
    current_file: Option<String>,
    auto_approve: bool,
) -> Result<PermissionProcessingResult, String> {
    let request: RequestPermissionRequest = serde_json::from_value(params.clone())
        .map_err(|e| format!("Invalid permission request: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let pending_input = PendingInput {
        id: format!("perm_req_{}", request_id),
        input_type: PendingInputType::ToolPermission,
        tool_name: request.tool_call.title.clone(),
        message: format!(
            "Permission requested: {}",
            request.tool_call.title.as_deref().unwrap_or("unknown tool")
        ),
        timestamp,
    };

    let update = AgentUpdate {
        agent_id,
        update_type: "permission_request".to_string(),
        message: Some(pending_input.message.clone()),
        tool: request.tool_call.title.clone().map(|name| ToolUpdate {
            name,
            input: None,
        }),
        progress: None,
        current_file,
        status: None,
        pending_inputs: None,
    };

    // Create response (auto-approve or wait for user)
    // Select the first "allow" option, or fall back to the first option
    let option_id = request.options
        .iter()
        .find(|o| matches!(o.kind, PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways))
        .map(|o| o.option_id.clone())
        .unwrap_or_else(|| request.options.first().map(|o| o.option_id.clone()).unwrap_or_default());

    let response = RequestPermissionResponse::selected(option_id);

    let rpc_response =
        JsonRpcResponse::success(request_id, serde_json::to_value(&response).unwrap());

    Ok(PermissionProcessingResult {
        update,
        pending_input,
        response: rpc_response,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_agent_id() -> Uuid {
        Uuid::parse_str("12345678-1234-1234-1234-123456789012").unwrap()
    }

    // =========================================================================
    // Session Update Processing Tests
    // =========================================================================

    #[test]
    fn test_process_agent_message_chunk() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "type": "agent_message_chunk",
                "content": {"type": "text", "text": "Hello, world!"}
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        // Should have one update
        assert_eq!(result.updates.len(), 1);
        assert_eq!(result.updates[0].update_type, "agent_message_chunk");
        assert_eq!(result.updates[0].message, Some("Hello, world!".to_string()));

        // Should accumulate text
        assert_eq!(result.accumulated_text, "Hello, world!");

        // No pending inputs for message chunks
        assert!(result.pending_inputs.is_empty());
    }

    #[test]
    fn test_process_tool_call_pending_creates_pending_input() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "type": "tool_call",
                "toolCallId": "tc-123",
                "title": "Write to important_file.rs",
                "status": "pending",
                "rawInput": {"file_path": "/src/important_file.rs"}
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        // Should have pending input notification AND the tool_call update
        assert_eq!(result.updates.len(), 2);

        // First update should be the pending_input notification
        let pending_update = &result.updates[0];
        assert_eq!(pending_update.update_type, "pending_input");
        assert!(pending_update
            .message
            .as_ref()
            .unwrap()
            .contains("Write to important_file.rs"));

        // Second update should be the actual tool_call
        let tool_update = &result.updates[1];
        assert_eq!(tool_update.update_type, "tool_call");

        // Should have pending input
        assert_eq!(result.pending_inputs.len(), 1);
        assert_eq!(result.pending_inputs[0].id, "tc-123");
        assert_eq!(
            result.pending_inputs[0].input_type,
            PendingInputType::ToolPermission
        );
        assert_eq!(
            result.pending_inputs[0].tool_name,
            Some("Write to important_file.rs".to_string())
        );

        // Should extract file path
        assert_eq!(
            result.current_file,
            Some("/src/important_file.rs".to_string())
        );
    }

    #[test]
    fn test_process_tool_call_in_progress_no_pending_input() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "type": "tool_call",
                "toolCallId": "tc-456",
                "title": "Reading file.rs",
                "status": "in_progress"
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        // Should have one update (the tool_call itself)
        assert_eq!(result.updates.len(), 1);
        assert_eq!(result.updates[0].update_type, "tool_call");

        // No pending inputs for in_progress
        assert!(result.pending_inputs.is_empty());
    }

    #[test]
    fn test_process_tool_call_completed_no_pending_input() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "type": "tool_call",
                "toolCallId": "tc-789",
                "title": "Completed reading",
                "status": "completed",
                "rawOutput": {"content": "file contents..."}
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        assert_eq!(result.updates.len(), 1);
        assert_eq!(result.updates[0].update_type, "tool_call");
        assert!(result.pending_inputs.is_empty());
    }

    #[test]
    fn test_process_tool_call_with_locations() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "type": "tool_call",
                "toolCallId": "tc-loc",
                "title": "Editing file",
                "status": "in_progress",
                "locations": [
                    {
                        "path": "/project/src/main.rs",
                        "range": {"start": {"line": 10, "character": 0}, "end": {"line": 20, "character": 0}}
                    }
                ]
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        // Should extract file path from locations
        assert_eq!(
            result.current_file,
            Some("/project/src/main.rs".to_string())
        );
    }

    #[test]
    fn test_process_plan_update() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "type": "plan",
                "entries": [
                    {"id": "1", "title": "Analyze code", "status": "completed"},
                    {"id": "2", "title": "Make changes", "status": "in_progress"},
                    {"id": "3", "title": "Run tests", "status": "pending"}
                ]
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        assert_eq!(result.updates.len(), 1);
        assert_eq!(result.updates[0].update_type, "plan");

        // Message should contain plan summary
        let message = result.updates[0].message.as_ref().unwrap();
        assert!(message.contains("Analyze code"));
        assert!(message.contains("Make changes"));
        assert!(message.contains("Run tests"));
    }

    #[test]
    fn test_process_mode_update() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "type": "current_mode_update",
                "mode": "architect"
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        assert_eq!(result.updates.len(), 1);
        assert_eq!(result.updates[0].update_type, "current_mode_update");
        assert_eq!(
            result.updates[0].message,
            Some("Mode: architect".to_string())
        );
    }

    // =========================================================================
    // Legacy Format Tests
    // =========================================================================

    #[test]
    fn test_process_legacy_agent_message() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "Legacy hello!"}
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        assert_eq!(result.updates.len(), 1);
        assert_eq!(result.updates[0].update_type, "agent_message_chunk");
        assert_eq!(
            result.updates[0].message,
            Some("Legacy hello!".to_string())
        );
        assert_eq!(result.accumulated_text, "Legacy hello!");
    }

    #[test]
    fn test_process_legacy_permission_request() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "sessionUpdate": "tool_use_permission_requested",
                "toolUseId": "legacy-tool-123",
                "name": "Write",
                "content": {"type": "text", "text": "Allow writing to config.json?"},
                "input": {"file_path": "/config.json"}
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        // Should have pending input update AND the main update
        assert_eq!(result.updates.len(), 2);
        assert_eq!(result.updates[0].update_type, "pending_input");

        // Should create pending input
        assert_eq!(result.pending_inputs.len(), 1);
        assert_eq!(result.pending_inputs[0].id, "legacy-tool-123");
        assert_eq!(
            result.pending_inputs[0].input_type,
            PendingInputType::ToolPermission
        );
        assert_eq!(
            result.pending_inputs[0].message,
            "Allow writing to config.json?"
        );

        // Should extract file path
        assert_eq!(result.current_file, Some("/config.json".to_string()));
    }

    #[test]
    fn test_process_legacy_confirmation() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "sessionUpdate": "confirmation_requested",
                "toolUseId": "confirm-123",
                "name": "Delete",
                "content": {"type": "text", "text": "Delete these 5 files?"}
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        assert_eq!(result.pending_inputs.len(), 1);
        assert_eq!(
            result.pending_inputs[0].input_type,
            PendingInputType::Confirmation
        );
    }

    #[test]
    fn test_process_legacy_user_input_request() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "update": {
                "sessionUpdate": "user_input_requested",
                "toolUseId": "input-123",
                "content": {"type": "text", "text": "What is the API key?"}
            }
        });

        let result = process_session_update(test_agent_id(), &params, None);

        assert_eq!(result.pending_inputs.len(), 1);
        assert_eq!(
            result.pending_inputs[0].input_type,
            PendingInputType::UserQuestion
        );
    }

    // =========================================================================
    // Permission Request Processing Tests
    // =========================================================================

    #[test]
    fn test_process_permission_request_auto_approve() {
        let params = serde_json::json!({
            "sessionId": "test-session",
            "toolCall": {
                "toolCallId": "tc-perm-1",
                "title": "Write to /etc/passwd",
                "status": "pending"
            },
            "options": [
                {"optionId": "opt-allow", "name": "Allow", "kind": "allow_once"},
                {"optionId": "opt-deny", "name": "Deny", "kind": "reject_once"}
            ]
        });

        let result =
            process_permission_request(test_agent_id(), 42, &params, None, true).unwrap();

        // Check pending input
        assert_eq!(result.pending_input.id, "perm_req_42");
        assert_eq!(
            result.pending_input.input_type,
            PendingInputType::ToolPermission
        );
        assert!(result
            .pending_input
            .message
            .contains("Write to /etc/passwd"));

        // Check update to frontend
        assert_eq!(result.update.update_type, "permission_request");
        assert!(result
            .update
            .message
            .as_ref()
            .unwrap()
            .contains("Write to /etc/passwd"));

        // Check response - should select the allow option
        let response_json = serde_json::to_string(&result.response).unwrap();
        assert!(response_json.contains("\"id\":42"));
        assert!(response_json.contains("opt-allow"));
    }

    #[test]
    fn test_process_permission_request_with_options() {
        let params = serde_json::json!({
            "sessionId": "session-xyz",
            "toolCall": {
                "toolCallId": "tc-opts",
                "title": "Run tests",
                "status": "pending"
            },
            "options": [
                {"optionId": "allow-once-id", "name": "Allow this once", "kind": "allow_once", "description": "Run once"},
                {"optionId": "allow-always-id", "name": "Always allow", "kind": "allow_always", "description": "Never ask again"},
                {"optionId": "reject-once-id", "name": "Deny", "kind": "reject_once"},
                {"optionId": "reject-always-id", "name": "Always deny", "kind": "reject_always"}
            ]
        });

        let result =
            process_permission_request(test_agent_id(), 99, &params, Some("/test".to_string()), true)
                .unwrap();

        assert_eq!(result.update.current_file, Some("/test".to_string()));
        assert_eq!(result.pending_input.tool_name, Some("Run tests".to_string()));

        // Should select the first allow option
        let response_json = serde_json::to_string(&result.response).unwrap();
        assert!(response_json.contains("allow-once-id"));
    }

    #[test]
    fn test_process_permission_request_invalid_params() {
        let params = serde_json::json!({
            "invalid": "data"
        });

        let result = process_permission_request(test_agent_id(), 1, &params, None, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid permission request"));
    }

    // =========================================================================
    // File Path Extraction Tests
    // =========================================================================

    #[test]
    fn test_extract_file_path_from_file_path() {
        let input = serde_json::json!({"file_path": "/home/user/code.rs"});
        assert_eq!(
            extract_file_path(&input),
            Some("/home/user/code.rs".to_string())
        );
    }

    #[test]
    fn test_extract_file_path_from_path() {
        let input = serde_json::json!({"path": "/project/main.go"});
        assert_eq!(
            extract_file_path(&input),
            Some("/project/main.go".to_string())
        );
    }

    #[test]
    fn test_extract_file_path_prefers_file_path() {
        let input = serde_json::json!({
            "file_path": "/preferred.rs",
            "path": "/fallback.rs"
        });
        assert_eq!(extract_file_path(&input), Some("/preferred.rs".to_string()));
    }

    #[test]
    fn test_extract_file_path_none() {
        let input = serde_json::json!({"content": "no file path here"});
        assert_eq!(extract_file_path(&input), None);
    }

    // =========================================================================
    // Edge Cases
    // =========================================================================

    #[test]
    fn test_process_invalid_json_returns_empty() {
        let params = serde_json::json!({
            "completely": "invalid",
            "structure": true
        });

        let result = process_session_update(test_agent_id(), &params, None);

        // Should return empty result, not crash
        assert!(result.updates.is_empty());
        assert!(result.pending_inputs.is_empty());
        assert!(result.accumulated_text.is_empty());
    }

    #[test]
    fn test_process_preserves_current_file_when_not_updated() {
        let params = serde_json::json!({
            "sessionId": "test",
            "update": {
                "type": "agent_message_chunk",
                "content": {"type": "text", "text": "Hi"}
            }
        });

        let result = process_session_update(
            test_agent_id(),
            &params,
            Some("/existing/file.rs".to_string()),
        );

        // Should preserve existing file
        assert_eq!(
            result.current_file,
            Some("/existing/file.rs".to_string())
        );
    }

    #[test]
    fn test_multiple_pending_tool_calls() {
        // First call
        let params1 = serde_json::json!({
            "sessionId": "test",
            "update": {
                "type": "tool_call",
                "toolCallId": "tc-1",
                "title": "First tool",
                "status": "pending"
            }
        });

        let result1 = process_session_update(test_agent_id(), &params1, None);
        assert_eq!(result1.pending_inputs.len(), 1);
        assert_eq!(result1.pending_inputs[0].id, "tc-1");

        // Second call (simulating multiple pending)
        let params2 = serde_json::json!({
            "sessionId": "test",
            "update": {
                "type": "tool_call",
                "toolCallId": "tc-2",
                "title": "Second tool",
                "status": "pending"
            }
        });

        let result2 = process_session_update(test_agent_id(), &params2, None);
        assert_eq!(result2.pending_inputs.len(), 1);
        assert_eq!(result2.pending_inputs[0].id, "tc-2");
    }
}
