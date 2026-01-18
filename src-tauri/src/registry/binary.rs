//! Binary distribution download and caching
use std::path::PathBuf;
use tokio::fs;
use tracing::{info, warn};

/// Get the platform identifier for binary distributions
pub fn get_platform() -> Option<&'static str> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some("darwin-aarch64");
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Some("darwin-x86_64");
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return Some("linux-aarch64");
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Some("linux-x86_64");
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Some("windows-x86_64");

    #[allow(unreachable_code)]
    None
}

/// Manager for downloading and caching binary agents
pub struct BinaryManager {
    cache_dir: PathBuf,
}

impl BinaryManager {
    pub fn new() -> Self {
        let cache_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("acptorio")
            .join("binaries");

        Self { cache_dir }
    }

    /// Get the path to a cached binary, downloading if needed
    pub async fn get_binary(
        &self,
        agent_id: &str,
        version: &str,
        archive_url: &str,
        cmd: &str,
    ) -> Result<PathBuf, BinaryError> {
        // Create version-specific directory
        let agent_dir = self.cache_dir.join(agent_id).join(version);
        let binary_path = agent_dir.join(cmd);

        // Check if already downloaded
        if binary_path.exists() {
            info!("Using cached binary: {:?}", binary_path);
            return Ok(binary_path);
        }

        // Download and extract
        info!("Downloading binary for {} v{} from {}", agent_id, version, archive_url);
        self.download_and_extract(archive_url, &agent_dir).await?;

        // Verify binary exists
        if !binary_path.exists() {
            return Err(BinaryError::BinaryNotFound(cmd.to_string()));
        }

        // Make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&binary_path).await?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&binary_path, perms).await?;
        }

        Ok(binary_path)
    }

    async fn download_and_extract(&self, url: &str, dest_dir: &PathBuf) -> Result<(), BinaryError> {
        // Create destination directory
        fs::create_dir_all(dest_dir).await?;

        // Download the archive
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| BinaryError::Download(e.to_string()))?;

        let response = client
            .get(url)
            .header("User-Agent", "ACPtorio/1.0")
            .send()
            .await
            .map_err(|e| BinaryError::Download(e.to_string()))?;

        if !response.status().is_success() {
            return Err(BinaryError::Download(format!(
                "HTTP {}: {}",
                response.status(),
                url
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| BinaryError::Download(e.to_string()))?;

        info!("Downloaded {} bytes, extracting...", bytes.len());

        // Determine archive type and extract
        if url.ends_with(".tar.gz") || url.ends_with(".tgz") {
            self.extract_tar_gz(&bytes, dest_dir).await?;
        } else if url.ends_with(".zip") {
            self.extract_zip(&bytes, dest_dir).await?;
        } else {
            return Err(BinaryError::UnsupportedArchive(url.to_string()));
        }

        Ok(())
    }

    async fn extract_tar_gz(&self, data: &[u8], dest_dir: &PathBuf) -> Result<(), BinaryError> {
        use flate2::read::GzDecoder;
        use tar::Archive;
        use std::io::Cursor;

        let cursor = Cursor::new(data);
        let decoder = GzDecoder::new(cursor);
        let mut archive = Archive::new(decoder);

        // Extract to destination
        archive
            .unpack(dest_dir)
            .map_err(|e| BinaryError::Extract(e.to_string()))?;

        info!("Extracted tar.gz to {:?}", dest_dir);
        Ok(())
    }

    async fn extract_zip(&self, data: &[u8], dest_dir: &PathBuf) -> Result<(), BinaryError> {
        use std::io::{Cursor, Read, Write};

        let cursor = Cursor::new(data);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|e| BinaryError::Extract(e.to_string()))?;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| BinaryError::Extract(e.to_string()))?;

            let outpath = match file.enclosed_name() {
                Some(path) => dest_dir.join(path),
                None => continue,
            };

            if file.is_dir() {
                std::fs::create_dir_all(&outpath)?;
            } else {
                if let Some(parent) = outpath.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let mut outfile = std::fs::File::create(&outpath)?;
                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer)
                    .map_err(|e| BinaryError::Extract(e.to_string()))?;
                outfile.write_all(&buffer)?;
            }

            // Set permissions on Unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(mode))?;
                }
            }
        }

        info!("Extracted zip to {:?}", dest_dir);
        Ok(())
    }
}

impl Default for BinaryManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BinaryError {
    #[error("Download failed: {0}")]
    Download(String),
    #[error("Extraction failed: {0}")]
    Extract(String),
    #[error("Unsupported archive format: {0}")]
    UnsupportedArchive(String),
    #[error("Binary not found in archive: {0}")]
    BinaryNotFound(String),
    #[error("Platform not supported")]
    UnsupportedPlatform,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
