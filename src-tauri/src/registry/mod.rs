pub mod binary;
mod service;
mod types;

pub use binary::{BinaryManager, BinaryError, get_platform};
pub use service::RegistryService;
pub use types::*;
