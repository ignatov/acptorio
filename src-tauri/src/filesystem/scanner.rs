use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
    pub explored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTree {
    pub root: String,
    pub tree: FileNode,
    pub total_files: usize,
    pub total_dirs: usize,
}

pub struct ProjectScanner {
    ignore_patterns: Vec<String>,
    max_depth: usize,
}

impl ProjectScanner {
    pub fn new() -> Self {
        Self {
            ignore_patterns: vec![
                ".git".to_string(),
                "node_modules".to_string(),
                "target".to_string(),
                ".DS_Store".to_string(),
                "dist".to_string(),
                "build".to_string(),
                "__pycache__".to_string(),
                ".venv".to_string(),
                "venv".to_string(),
                ".idea".to_string(),
                ".vscode".to_string(),
            ],
            max_depth: 10,
        }
    }

    pub fn with_ignore_patterns(mut self, patterns: Vec<String>) -> Self {
        self.ignore_patterns = patterns;
        self
    }

    pub fn with_max_depth(mut self, depth: usize) -> Self {
        self.max_depth = depth;
        self
    }

    pub fn scan(&self, root: &Path) -> Result<ProjectTree, ScannerError> {
        if !root.exists() {
            return Err(ScannerError::PathNotFound(root.to_string_lossy().to_string()));
        }

        if !root.is_dir() {
            return Err(ScannerError::NotADirectory(root.to_string_lossy().to_string()));
        }

        let mut total_files = 0;
        let mut total_dirs = 0;

        let tree = self.scan_dir(root, 0, &mut total_files, &mut total_dirs)?;

        Ok(ProjectTree {
            root: root.to_string_lossy().to_string(),
            tree,
            total_files,
            total_dirs,
        })
    }

    fn scan_dir(
        &self,
        path: &Path,
        depth: usize,
        total_files: &mut usize,
        total_dirs: &mut usize,
    ) -> Result<FileNode, ScannerError> {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string());

        if depth >= self.max_depth {
            return Ok(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                children: None,
                explored: false,
            });
        }

        let mut children = Vec::new();

        let entries = fs::read_dir(path).map_err(|e| ScannerError::ReadError(e.to_string()))?;

        for entry in entries {
            let entry = entry.map_err(|e| ScannerError::ReadError(e.to_string()))?;
            let entry_path = entry.path();
            let entry_name = entry
                .file_name()
                .to_string_lossy()
                .to_string();

            // Skip ignored patterns
            if self.should_ignore(&entry_name) {
                continue;
            }

            if entry_path.is_dir() {
                *total_dirs += 1;
                let child = self.scan_dir(&entry_path, depth + 1, total_files, total_dirs)?;
                children.push(child);
            } else {
                *total_files += 1;
                children.push(FileNode {
                    name: entry_name,
                    path: entry_path.to_string_lossy().to_string(),
                    is_dir: false,
                    children: None,
                    explored: false,
                });
            }
        }

        // Sort: directories first, then alphabetically
        children.sort_by(|a, b| {
            match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });

        Ok(FileNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir: true,
            children: Some(children),
            explored: true,
        })
    }

    fn should_ignore(&self, name: &str) -> bool {
        self.ignore_patterns.iter().any(|p| {
            if p.starts_with("*.") {
                name.ends_with(&p[1..])
            } else {
                name == p
            }
        })
    }
}

impl Default for ProjectScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ScannerError {
    #[error("Path not found: {0}")]
    PathNotFound(String),
    #[error("Not a directory: {0}")]
    NotADirectory(String),
    #[error("Read error: {0}")]
    ReadError(String),
}
