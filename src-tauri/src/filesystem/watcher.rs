use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEvent {
    pub kind: FileEventKind,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileEventKind {
    Create,
    Modify,
    Remove,
    Rename,
    Other,
}

impl From<notify::EventKind> for FileEventKind {
    fn from(kind: notify::EventKind) -> Self {
        use notify::EventKind::*;
        match kind {
            Create(_) => FileEventKind::Create,
            Modify(_) => FileEventKind::Modify,
            Remove(_) => FileEventKind::Remove,
            _ => FileEventKind::Other,
        }
    }
}

pub struct FileSystemWatcher {
    watcher: RecommendedWatcher,
    app_handle: AppHandle,
}

impl FileSystemWatcher {
    pub fn new(app_handle: AppHandle) -> Result<Self, WatcherError> {
        let app_handle_clone = app_handle.clone();

        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let file_event = FileEvent {
                        kind: event.kind.into(),
                        paths: event
                            .paths
                            .iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect(),
                    };
                    let _ = app_handle_clone.emit("fs-change", &file_event);
                }
            },
            Config::default(),
        )
        .map_err(|e| WatcherError::InitFailed(e.to_string()))?;

        Ok(Self {
            watcher,
            app_handle,
        })
    }

    pub fn watch(&mut self, path: &Path) -> Result<(), WatcherError> {
        self.watcher
            .watch(path, RecursiveMode::Recursive)
            .map_err(|e| WatcherError::WatchFailed(e.to_string()))
    }

    pub fn unwatch(&mut self, path: &Path) -> Result<(), WatcherError> {
        self.watcher
            .unwatch(path)
            .map_err(|e| WatcherError::UnwatchFailed(e.to_string()))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WatcherError {
    #[error("Watcher init failed: {0}")]
    InitFailed(String),
    #[error("Watch failed: {0}")]
    WatchFailed(String),
    #[error("Unwatch failed: {0}")]
    UnwatchFailed(String),
}
