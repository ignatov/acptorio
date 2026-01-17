use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: i64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcRequest {
    pub fn new(id: i64, method: &str, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl JsonRpcResponse {
    /// Create a successful response
    pub fn success(id: i64, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id: Some(id),
            result: Some(result),
            error: None,
        }
    }

    /// Create an error response
    pub fn error(id: i64, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id: Some(id),
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub enum JsonRpcMessage {
    Request(JsonRpcRequest),
    Response(JsonRpcResponse),
    Notification(JsonRpcNotification),
}

// Custom deserializer to properly dispatch based on fields present
impl<'de> Deserialize<'de> for JsonRpcMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        // First deserialize into a generic Value to inspect fields
        let value = Value::deserialize(deserializer)?;

        // Check if it's an object
        let obj = value.as_object().ok_or_else(|| {
            serde::de::Error::custom("JSON-RPC message must be an object")
        })?;

        // Determine type based on fields present:
        // - Request: has "id" (non-null) and "method"
        // - Response: has "id" (non-null) and ("result" or "error"), no "method"
        // - Notification: has "method" but no "id" (or id is null)
        //
        // Note: ACP may send notifications with "id": null, so we must check
        // that id is present AND non-null to distinguish from notifications.

        let has_method = obj.contains_key("method");
        let has_result = obj.contains_key("result");
        let has_error = obj.contains_key("error");

        // Check if id exists AND is not null
        let has_non_null_id = obj.get("id").map(|v| !v.is_null()).unwrap_or(false);

        if has_method && has_non_null_id {
            // Request: has both non-null id and method
            let req: JsonRpcRequest = serde_json::from_value(value)
                .map_err(serde::de::Error::custom)?;
            Ok(JsonRpcMessage::Request(req))
        } else if has_method {
            // Notification: has method but no id (or id is null)
            let notif: JsonRpcNotification = serde_json::from_value(value)
                .map_err(serde::de::Error::custom)?;
            Ok(JsonRpcMessage::Notification(notif))
        } else if has_non_null_id || has_result || has_error {
            // Response: has non-null id, result, or error (but not method)
            let resp: JsonRpcResponse = serde_json::from_value(value)
                .map_err(serde::de::Error::custom)?;
            Ok(JsonRpcMessage::Response(resp))
        } else {
            Err(serde::de::Error::custom(
                "Cannot determine JSON-RPC message type"
            ))
        }
    }
}

impl JsonRpcMessage {
    pub fn parse(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    pub fn is_notification(&self) -> bool {
        matches!(self, JsonRpcMessage::Notification(_))
    }

    pub fn is_response(&self) -> bool {
        matches!(self, JsonRpcMessage::Response(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_serialization() {
        let req = JsonRpcRequest::new(1, "initialize", Some(serde_json::json!({"foo": "bar"})));
        let json = serde_json::to_string(&req).unwrap();

        assert!(json.contains("\"jsonrpc\":\"2.0\""));
        assert!(json.contains("\"id\":1"));
        assert!(json.contains("\"method\":\"initialize\""));
        assert!(json.contains("\"params\""));
    }

    #[test]
    fn test_response_success_deserialization() {
        let json = r#"{"jsonrpc":"2.0","id":1,"result":{"sessionId":"abc123"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        match msg {
            JsonRpcMessage::Response(resp) => {
                assert_eq!(resp.id, Some(1));
                assert!(resp.result.is_some());
                assert!(resp.error.is_none());
            }
            _ => panic!("Expected Response"),
        }
    }

    #[test]
    fn test_response_error_deserialization() {
        let json = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid params"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        match msg {
            JsonRpcMessage::Response(resp) => {
                assert!(resp.error.is_some());
                let err = resp.error.unwrap();
                assert_eq!(err.code, -32600);
                assert_eq!(err.message, "Invalid params");
            }
            _ => panic!("Expected Response"),
        }
    }

    #[test]
    fn test_notification_deserialization() {
        let json = r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        match msg {
            JsonRpcMessage::Notification(notif) => {
                assert_eq!(notif.method, "session/update");
                assert!(notif.params.is_some());
            }
            _ => panic!("Expected Notification"),
        }
    }

    #[test]
    fn test_message_dispatch() {
        // Response (has id and result, no method)
        let resp_json = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
        let resp = JsonRpcMessage::parse(resp_json).unwrap();
        assert!(resp.is_response());
        assert!(!resp.is_notification());

        // Notification (has method, no id)
        let notif_json = r#"{"jsonrpc":"2.0","method":"test","params":{}}"#;
        let notif = JsonRpcMessage::parse(notif_json).unwrap();
        assert!(notif.is_notification());
        assert!(!notif.is_response());
    }

    #[test]
    fn test_notification_with_null_id() {
        // ACP may send notifications with "id": null - this should still be a Notification
        let json = r#"{"jsonrpc":"2.0","id":null,"method":"session/update","params":{"sessionId":"abc"}}"#;
        let msg = JsonRpcMessage::parse(json).unwrap();

        match msg {
            JsonRpcMessage::Notification(notif) => {
                assert_eq!(notif.method, "session/update");
                assert!(notif.params.is_some());
            }
            _ => panic!("Expected Notification, got {:?}", msg),
        }
    }

    #[test]
    fn test_request_deserialization() {
        // Request from agent (has both id and method)
        let json = r#"{"jsonrpc":"2.0","id":42,"method":"session/request_permission","params":{"sessionId":"abc"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        match msg {
            JsonRpcMessage::Request(req) => {
                assert_eq!(req.id, 42);
                assert_eq!(req.method, "session/request_permission");
                assert!(req.params.is_some());
            }
            _ => panic!("Expected Request, got {:?}", msg),
        }
    }

    #[test]
    fn test_response_success_helper() {
        let response = JsonRpcResponse::success(123, serde_json::json!({"status": "ok"}));
        let json = serde_json::to_string(&response).unwrap();

        assert!(json.contains("\"jsonrpc\":\"2.0\""));
        assert!(json.contains("\"id\":123"));
        assert!(json.contains("\"result\":{\"status\":\"ok\"}"));
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn test_response_error_helper() {
        let response = JsonRpcResponse::error(456, -32601, "Method not found");
        let json = serde_json::to_string(&response).unwrap();

        assert!(json.contains("\"jsonrpc\":\"2.0\""));
        assert!(json.contains("\"id\":456"));
        assert!(json.contains("\"error\""));
        assert!(json.contains("\"code\":-32601"));
        assert!(json.contains("\"message\":\"Method not found\""));
        assert!(!json.contains("\"result\""));
    }
}
