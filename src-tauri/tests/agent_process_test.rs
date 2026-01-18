//! Tests for AgentProcess
//!
//! Run with: cargo test --test agent_process_test -- --nocapture
//! Some tests require ANTHROPIC_API_KEY

use acptorio_lib::agent::{AgentProcess, AgentStatus, AgentUpdate, PendingPermissions};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Test spawning an agent process
#[tokio::test]
async fn test_spawn_agent() {
    let result = AgentProcess::spawn("test-agent".into(), "/tmp".into()).await;

    match result {
        Ok(agent) => {
            assert_eq!(agent.name, "test-agent");
            assert_eq!(agent.working_directory, "/tmp");
            assert_eq!(agent.status, AgentStatus::Initializing);
            println!("Agent spawned with id: {}", agent.id);
        }
        Err(e) => {
            panic!("Failed to spawn agent: {}", e);
        }
    }
}

/// Test initialize handshake
#[tokio::test]
async fn test_initialize_agent() {
    let mut agent = AgentProcess::spawn("test-agent".into(), "/tmp".into())
        .await
        .expect("Failed to spawn");

    let result = agent.initialize().await;

    match result {
        Ok(()) => {
            assert_eq!(agent.status, AgentStatus::Idle);
            println!("Agent initialized successfully");
        }
        Err(e) => {
            panic!("Initialize failed: {}", e);
        }
    }

    agent.stop().await.expect("Failed to stop");
}

/// Test session creation
#[tokio::test]
async fn test_create_session() {
    let mut agent = AgentProcess::spawn("test-agent".into(), "/tmp".into())
        .await
        .expect("Failed to spawn");

    agent.initialize().await.expect("Initialize failed");

    let result = agent.create_session().await;

    match result {
        Ok(session_id) => {
            assert!(!session_id.is_empty());
            assert_eq!(agent.session_id, Some(session_id.clone()));
            println!("Session created: {}", session_id);
        }
        Err(e) => {
            panic!("Create session failed: {}", e);
        }
    }

    agent.stop().await.expect("Failed to stop");
}

/// Test full prompt flow
#[tokio::test]
#[ignore] // Requires API key and makes real API call
async fn test_send_prompt() {
    let mut agent = AgentProcess::spawn("test-agent".into(), "/tmp".into())
        .await
        .expect("Failed to spawn");

    agent.initialize().await.expect("Initialize failed");
    let session_id = agent.create_session().await.expect("Session create failed");
    println!("Session: {}", session_id);

    let (tx, mut rx) = mpsc::channel::<AgentUpdate>(100);

    // Spawn a task to collect updates
    let collector = tokio::spawn(async move {
        let mut updates = Vec::new();
        while let Some(update) = rx.recv().await {
            println!("Update: {} - {:?}", update.update_type, update.message);
            updates.push(update);
        }
        updates
    });

    // Send prompt
    let pending_permissions = Arc::new(PendingPermissions::new());
    let result = agent.send_prompt("Say hello in one word", tx, pending_permissions).await;

    match result {
        Ok(text) => {
            println!("Result text: '{}'", text);
            assert!(!text.is_empty(), "Expected some text in result");
        }
        Err(e) => {
            panic!("Send prompt failed: {}", e);
        }
    }

    assert_eq!(agent.status, AgentStatus::Idle);
    assert_eq!(agent.progress, 100.0);

    // Check updates were received
    drop(agent); // This closes the tx channel
    let updates = collector.await.expect("Collector task failed");
    println!("Received {} updates", updates.len());
    assert!(!updates.is_empty(), "Expected at least one update");
}

/// Test stopping an agent
#[tokio::test]
async fn test_stop_agent() {
    let mut agent = AgentProcess::spawn("test-agent".into(), "/tmp".into())
        .await
        .expect("Failed to spawn");

    agent.initialize().await.expect("Initialize failed");

    let result = agent.stop().await;

    match result {
        Ok(()) => {
            assert_eq!(agent.status, AgentStatus::Stopped);
            println!("Agent stopped successfully");
        }
        Err(e) => {
            panic!("Stop failed: {}", e);
        }
    }
}
