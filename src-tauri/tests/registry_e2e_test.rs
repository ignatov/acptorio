//! E2E tests for registry agent spawning
//!
//! These tests fetch the real registry and verify agents can be spawned.
//! Run with: cargo test --test registry_e2e_test -- --nocapture
//!
//! Note: Requires network access and npx installed.

use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

/// Registry agent structure matching the remote format
#[derive(Debug, Clone, serde::Deserialize)]
struct RegistryAgent {
    id: String,
    name: String,
    version: String,
    description: String,
    #[serde(default)]
    icon: Option<String>,
    distribution: Distribution,
}

#[derive(Debug, Clone, serde::Deserialize, Default)]
struct Distribution {
    #[serde(default)]
    npx: Option<NpxDistribution>,
    #[serde(default)]
    binary: Option<HashMap<String, BinaryPlatform>>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct NpxDistribution {
    package: String,
    #[serde(default)]
    args: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct BinaryPlatform {
    archive: String,
    cmd: String,
    #[serde(default)]
    args: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct Registry {
    version: String,
    agents: Vec<RegistryAgent>,
}

const REGISTRY_URL: &str =
    "https://github.com/agentclientprotocol/registry/releases/latest/download/registry.json";

/// Fetch the real registry from GitHub
async fn fetch_registry() -> Result<Registry, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(REGISTRY_URL)
        .header("User-Agent", "ACPtorio-Test/1.0")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch registry: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Registry fetch failed with status: {}", response.status()));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse registry: {}", e))
}

/// Build command and args from a Distribution
fn build_spawn_command(distribution: &Distribution) -> Result<(String, Vec<String>), String> {
    if let Some(ref npx) = distribution.npx {
        let mut args = vec![npx.package.clone()];
        args.extend(npx.args.clone());
        return Ok(("npx".to_string(), args));
    }

    Err("No npx distribution available".to_string())
}

/// Test that we can fetch the registry
#[tokio::test]
async fn test_fetch_registry() {
    let registry = fetch_registry().await.expect("Failed to fetch registry");

    println!("Registry version: {}", registry.version);
    println!("Number of agents: {}", registry.agents.len());

    assert!(!registry.agents.is_empty(), "Registry should have agents");

    for agent in &registry.agents {
        println!(
            "  - {} ({}): {} - has npx: {}, has binary: {}",
            agent.name,
            agent.id,
            agent.version,
            agent.distribution.npx.is_some(),
            agent.distribution.binary.is_some()
        );
    }
}

/// Test that registry contains expected agents
#[tokio::test]
async fn test_registry_contains_expected_agents() {
    let registry = fetch_registry().await.expect("Failed to fetch registry");

    // These agents should be in the registry
    let expected_agents = ["codex-acp", "gemini", "github-copilot"];

    for expected in expected_agents {
        let found = registry.agents.iter().any(|a| a.id == expected);
        assert!(found, "Registry should contain agent: {}", expected);
    }
}

/// Test that we can spawn an agent from the registry
async fn spawn_and_verify_agent(agent: &RegistryAgent) -> Result<(), String> {
    let (cmd, args) = build_spawn_command(&agent.distribution)?;

    println!("Spawning {} with: {} {:?}", agent.id, cmd, args);

    let mut child = Command::new(&cmd)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", agent.id, e))?;

    // Give it time to start
    tokio::time::sleep(Duration::from_secs(3)).await;

    // Check if still running
    let status = child.try_wait().map_err(|e| format!("Failed to check status: {}", e))?;
    if let Some(exit) = status {
        return Err(format!("Process exited early with: {:?}", exit));
    }

    // Try to send initialize request
    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    let mut writer = stdin;
    let mut reader = BufReader::new(stdout);

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": {
                    "readTextFile": true,
                    "writeTextFile": true
                }
            },
            "clientInfo": {
                "name": "registry-e2e-test",
                "version": "0.1.0"
            }
        }
    });

    let request_str = serde_json::to_string(&request).unwrap();
    println!(">>> Sending to {}: {}", agent.id, request_str);

    writer
        .write_all(request_str.as_bytes())
        .await
        .map_err(|e| format!("Failed to write: {}", e))?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|e| format!("Failed to write newline: {}", e))?;
    writer
        .flush()
        .await
        .map_err(|e| format!("Failed to flush: {}", e))?;

    // Read response with timeout
    let mut line = String::new();
    let read_result = tokio::time::timeout(Duration::from_secs(15), reader.read_line(&mut line)).await;

    let _ = child.kill().await;

    match read_result {
        Ok(Ok(bytes)) if bytes > 0 => {
            println!("<<< Received from {}: {}", agent.id, line.trim());

            let response: serde_json::Value =
                serde_json::from_str(&line).map_err(|e| format!("Failed to parse JSON: {}", e))?;

            if response["jsonrpc"] != "2.0" {
                return Err("Invalid JSON-RPC version".to_string());
            }

            if response["id"] != 1 {
                return Err("Response ID mismatch".to_string());
            }

            if response.get("error").is_some() {
                // Some agents may error on initialize (auth issues), but that's OK
                // The important thing is they responded with valid JSON-RPC
                println!(
                    "Agent {} returned error (may need auth): {}",
                    agent.id, response["error"]
                );
            } else {
                println!("Agent {} initialized successfully!", agent.id);
            }

            Ok(())
        }
        Ok(Ok(_)) => Err("Empty response".to_string()),
        Ok(Err(e)) => Err(format!("Read error: {}", e)),
        Err(_) => Err("Timeout waiting for response".to_string()),
    }
}

/// Test spawning Claude Code agent (built-in, should always work)
#[tokio::test]
async fn test_spawn_claude_code() {
    let agent = RegistryAgent {
        id: "claude".to_string(),
        name: "Claude Code".to_string(),
        version: "latest".to_string(),
        description: "Anthropic's Claude AI coding assistant".to_string(),
        icon: None,
        distribution: Distribution {
            npx: Some(NpxDistribution {
                package: "@zed-industries/claude-code-acp@latest".to_string(),
                args: vec![],
            }),
            binary: None,
        },
    };

    spawn_and_verify_agent(&agent)
        .await
        .expect("Failed to spawn Claude Code");
}

/// Test spawning all npx-based agents from registry
#[tokio::test]
async fn test_spawn_all_npx_agents() {
    let registry = fetch_registry().await.expect("Failed to fetch registry");

    let mut results: Vec<(String, Result<(), String>)> = Vec::new();

    for agent in registry.agents {
        if agent.distribution.npx.is_some() {
            println!("\n=== Testing {} ===", agent.name);
            let result = spawn_and_verify_agent(&agent).await;
            results.push((agent.id.clone(), result));
        } else {
            println!("Skipping {} (no npx distribution)", agent.id);
        }
    }

    // Print summary
    println!("\n=== RESULTS ===");
    let mut passed = 0;
    let mut failed = 0;

    for (id, result) in &results {
        match result {
            Ok(_) => {
                println!("✓ {} - OK", id);
                passed += 1;
            }
            Err(e) => {
                println!("✗ {} - FAILED: {}", id, e);
                failed += 1;
            }
        }
    }

    println!("\nPassed: {}, Failed: {}", passed, failed);

    // At least Claude should work
    assert!(passed > 0, "At least one agent should spawn successfully");
}

/// Test that the spawn command builder works correctly
#[test]
fn test_build_spawn_command() {
    let dist = Distribution {
        npx: Some(NpxDistribution {
            package: "@example/agent@1.0.0".to_string(),
            args: vec!["--flag".to_string()],
        }),
        binary: None,
    };

    let (cmd, args) = build_spawn_command(&dist).expect("Should build command");
    assert_eq!(cmd, "npx");
    assert_eq!(args, vec!["@example/agent@1.0.0", "--flag"]);
}

/// Test that agents without npx distribution return appropriate error
#[tokio::test]
async fn test_binary_only_agents_error() {
    let registry = fetch_registry().await.expect("Failed to fetch registry");

    for agent in &registry.agents {
        let result = build_spawn_command(&agent.distribution);

        if agent.distribution.npx.is_some() {
            assert!(result.is_ok(), "Agent {} with npx should succeed", agent.id);
        } else {
            assert!(result.is_err(), "Agent {} without npx should fail", agent.id);
            let err = result.unwrap_err();
            println!("{}: {}", agent.id, err);
            // Should be an informative error
            assert!(
                err.contains("not yet supported") ||
                err.contains("not available") ||
                err.contains("No npx distribution") ||
                err.contains("No supported distribution"),
                "Error should be informative: {}", err
            );
        }
    }
}

/// Test registry agent distribution format parsing
#[test]
fn test_parse_registry_format() {
    let json = r#"{
        "version": "2024.01.01",
        "agents": [
            {
                "id": "test-agent",
                "name": "Test Agent",
                "version": "1.0.0",
                "description": "A test agent",
                "icon": "https://example.com/icon.svg",
                "distribution": {
                    "npx": {
                        "package": "@test/agent@1.0.0",
                        "args": ["--acp"]
                    }
                }
            }
        ]
    }"#;

    let registry: Registry = serde_json::from_str(json).expect("Failed to parse");
    assert_eq!(registry.agents.len(), 1);
    assert_eq!(registry.agents[0].id, "test-agent");
    assert!(registry.agents[0].distribution.npx.is_some());
}
