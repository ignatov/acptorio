pub mod manager;
pub mod message_processor;
pub mod pool;
pub mod process;

pub use manager::*;
pub use pool::*;
pub use process::*;

// Re-export only the processing functions, not the duplicate types
pub use message_processor::{
    process_session_update,
    process_typed_session_update,
    process_legacy_session_update,
    process_permission_request,
    extract_file_path,
    ProcessingResult,
    PermissionProcessingResult,
};
