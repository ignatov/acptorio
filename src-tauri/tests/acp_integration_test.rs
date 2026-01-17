//! Integration tests for ACP communication
//!
//! These tests actually spawn the claude-code-acp process and test real communication.
//! Run with: cargo test --test acp_integration_test -- --nocapture
//!
//! Note: Some tests require ANTHROPIC_API_KEY to be set.

use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

/// Test that we can spawn claude-code-acp and it starts
#[tokio::test]
async fn test_spawn_acp_process() {
    let mut child = Command::new("npx")
        .arg("@zed-industries/claude-code-acp@latest")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to spawn acp process");

    // Give it a moment to start
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Should still be running
    let status = child.try_wait().expect("Failed to check process status");
    assert!(status.is_none(), "Process should still be running");

    child.kill().await.expect("Failed to kill process");
}

/// Test initialize request/response
#[tokio::test]
async fn test_initialize_handshake() {
    let mut child = Command::new("npx")
        .arg("@zed-industries/claude-code-acp@latest")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to spawn acp process");

    let stdin = child.stdin.take().expect("Failed to get stdin");
    let stdout = child.stdout.take().expect("Failed to get stdout");

    let mut writer = stdin;
    let mut reader = BufReader::new(stdout);

    // Wait for process to be ready
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Send initialize request
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "capabilities": {},
            "clientInfo": {
                "name": "integration-test",
                "version": "0.1.0"
            }
        }
    });

    let request_str = serde_json::to_string(&request).unwrap();
    println!(">>> Sending: {}", request_str);

    writer.write_all(request_str.as_bytes()).await.expect("Failed to write");
    writer.write_all(b"\n").await.expect("Failed to write newline");
    writer.flush().await.expect("Failed to flush");

    // Read response with timeout
    let mut line = String::new();
    let read_result = tokio::time::timeout(
        tokio::time::Duration::from_secs(10),
        reader.read_line(&mut line)
    ).await;

    match read_result {
        Ok(Ok(bytes)) if bytes > 0 => {
            println!("<<< Received: {}", line.trim());

            // Parse and verify it's a valid response
            let response: serde_json::Value = serde_json::from_str(&line).expect("Failed to parse JSON");

            assert_eq!(response["jsonrpc"], "2.0");
            assert_eq!(response["id"], 1);
            assert!(response.get("result").is_some() || response.get("error").is_some(),
                    "Response should have result or error");

            if response.get("error").is_some() {
                panic!("Initialize returned error: {}", response["error"]);
            }

            println!("Initialize succeeded!");
        }
        Ok(Ok(_)) => panic!("Empty response"),
        Ok(Err(e)) => panic!("Read error: {}", e),
        Err(_) => panic!("Timeout waiting for response"),
    }

    child.kill().await.expect("Failed to kill process");
}

/// Test full session lifecycle: initialize -> session/new -> session/prompt
#[tokio::test]
#[ignore] // Requires ANTHROPIC_API_KEY
async fn test_full_prompt_flow() {
    let mut child = Command::new("npx")
        .arg("@zed-industries/claude-code-acp@latest")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to spawn acp process");

    let stdin = child.stdin.take().expect("Failed to get stdin");
    let stdout = child.stdout.take().expect("Failed to get stdout");

    let mut writer = stdin;
    let mut reader = BufReader::new(stdout);
    let mut request_id = 1;

    // Helper to send request and read response
    async fn send_and_wait(
        writer: &mut tokio::process::ChildStdin,
        reader: &mut BufReader<tokio::process::ChildStdout>,
        request: serde_json::Value,
    ) -> serde_json::Value {
        let request_str = serde_json::to_string(&request).unwrap();
        println!(">>> {}", request_str);

        writer.write_all(request_str.as_bytes()).await.unwrap();
        writer.write_all(b"\n").await.unwrap();
        writer.flush().await.unwrap();

        // Read lines until we get a response (has "id" field matching our request)
        loop {
            let mut line = String::new();
            let result = tokio::time::timeout(
                tokio::time::Duration::from_secs(60),
                reader.read_line(&mut line)
            ).await;

            match result {
                Ok(Ok(bytes)) if bytes > 0 => {
                    println!("<<< {}", line.trim());
                    let msg: serde_json::Value = serde_json::from_str(&line).unwrap();

                    // Check if this is our response (has id matching request)
                    if msg.get("id") == request.get("id") {
                        return msg;
                    }
                    // Otherwise it's a notification, continue reading
                }
                Ok(Ok(_)) => panic!("EOF"),
                Ok(Err(e)) => panic!("Read error: {}", e),
                Err(_) => panic!("Timeout"),
            }
        }
    }

    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Step 1: Initialize
    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "0.1.0"}
        }
    });
    request_id += 1;

    let init_resp = send_and_wait(&mut writer, &mut reader, init_req).await;
    assert!(init_resp.get("error").is_none(), "Initialize failed");
    println!("Initialize: OK");

    // Step 2: Session new
    let session_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "session/new",
        "params": {
            "cwd": "/tmp",
            "mcpServers": []
        }
    });
    request_id += 1;

    let session_resp = send_and_wait(&mut writer, &mut reader, session_req).await;
    assert!(session_resp.get("error").is_none(), "Session new failed");

    let session_id = session_resp["result"]["sessionId"].as_str()
        .expect("Missing sessionId");
    println!("Session created: {}", session_id);

    // Step 3: Send prompt
    let prompt_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "session/prompt",
        "params": {
            "sessionId": session_id,
            "prompt": [{"type": "text", "text": "Say hello in one word"}]
        }
    });

    let prompt_resp = send_and_wait(&mut writer, &mut reader, prompt_req).await;
    assert!(prompt_resp.get("error").is_none(), "Prompt failed: {:?}", prompt_resp);
    println!("Prompt completed with stopReason: {}", prompt_resp["result"]["stopReason"]);

    child.kill().await.expect("Failed to kill process");
}
