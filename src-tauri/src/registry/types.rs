use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single agent provider from the registry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryAgent {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub icon: Option<String>,
    pub distribution: Distribution,
}

/// How to spawn/run the agent - matches the actual registry format
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Distribution {
    #[serde(default)]
    pub npx: Option<NpxDistribution>,
    #[serde(default)]
    pub binary: Option<HashMap<String, BinaryPlatform>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpxDistribution {
    pub package: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryPlatform {
    pub archive: String,
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
}

/// The full registry structure from the remote
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registry {
    pub version: String,
    pub agents: Vec<RegistryAgent>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            version: "1.0.0".to_string(),
            agents: Vec::new(),
        }
    }
}

/// Get the built-in Claude agent
pub fn get_claude_agent() -> RegistryAgent {
    RegistryAgent {
        id: "claude".to_string(),
        name: "Claude Code".to_string(),
        version: "latest".to_string(),
        description: "Anthropic's Claude AI coding assistant".to_string(),
        icon: None,
        distribution: Distribution {
            npx: Some(NpxDistribution {
                package: "@zed-industries/claude-code-acp@latest".to_string(),
                args: Vec::new(),
                env: HashMap::new(),
            }),
            binary: None,
        },
    }
}

