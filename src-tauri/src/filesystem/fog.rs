use dashmap::DashSet;
use serde::{Deserialize, Serialize};

pub struct FogOfWar {
    explored_paths: DashSet<String>,
}

impl FogOfWar {
    pub fn new() -> Self {
        Self {
            explored_paths: DashSet::new(),
        }
    }

    pub fn reveal(&self, path: &str) {
        self.explored_paths.insert(path.to_string());
    }

    pub fn reveal_many(&self, paths: &[String]) {
        for path in paths {
            self.explored_paths.insert(path.clone());
        }
    }

    pub fn is_explored(&self, path: &str) -> bool {
        self.explored_paths.contains(path)
    }

    pub fn explored_paths(&self) -> Vec<String> {
        self.explored_paths.iter().map(|p| p.clone()).collect()
    }

    pub fn reset(&self) {
        self.explored_paths.clear();
    }

    pub fn explored_count(&self) -> usize {
        self.explored_paths.len()
    }
}

impl Default for FogOfWar {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FogState {
    pub explored_paths: Vec<String>,
    pub total_explored: usize,
}

impl From<&FogOfWar> for FogState {
    fn from(fog: &FogOfWar) -> Self {
        Self {
            explored_paths: fog.explored_paths(),
            total_explored: fog.explored_count(),
        }
    }
}
