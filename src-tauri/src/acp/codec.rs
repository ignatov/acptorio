use super::protocol::JsonRpcMessage;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as TokioBufReader};
use tokio::process::{ChildStdin, ChildStdout};

pub struct AsyncCodec {
    reader: TokioBufReader<ChildStdout>,
    writer: ChildStdin,
}

impl AsyncCodec {
    pub fn new(stdout: ChildStdout, stdin: ChildStdin) -> Self {
        Self {
            reader: TokioBufReader::new(stdout),
            writer: stdin,
        }
    }

    pub async fn read_message(&mut self) -> Result<Option<JsonRpcMessage>, CodecError> {
        let mut line = String::new();
        let bytes_read = self
            .reader
            .read_line(&mut line)
            .await
            .map_err(CodecError::Io)?;

        if bytes_read == 0 {
            return Ok(None);
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        // Debug: log raw message
        println!("[CODEC] RAW message: {}", trimmed);

        let message = serde_json::from_str(trimmed).map_err(CodecError::Json)?;
        Ok(Some(message))
    }

    pub async fn write_message(&mut self, message: &str) -> Result<(), CodecError> {
        self.writer
            .write_all(message.as_bytes())
            .await
            .map_err(CodecError::Io)?;
        self.writer
            .write_all(b"\n")
            .await
            .map_err(CodecError::Io)?;
        self.writer.flush().await.map_err(CodecError::Io)?;
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CodecError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
