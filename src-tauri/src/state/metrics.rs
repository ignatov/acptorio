use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

pub struct MetricsTracker {
    total_input_tokens: AtomicU64,
    total_output_tokens: AtomicU64,
    total_cost_cents: AtomicU64,
    session_start: RwLock<Option<std::time::Instant>>,
}

impl MetricsTracker {
    pub fn new() -> Self {
        Self {
            total_input_tokens: AtomicU64::new(0),
            total_output_tokens: AtomicU64::new(0),
            total_cost_cents: AtomicU64::new(0),
            session_start: RwLock::new(Some(std::time::Instant::now())),
        }
    }

    pub fn add_tokens(&self, input: u64, output: u64) {
        self.total_input_tokens.fetch_add(input, Ordering::Relaxed);
        self.total_output_tokens.fetch_add(output, Ordering::Relaxed);
    }

    pub fn add_cost(&self, cost_cents: u64) {
        self.total_cost_cents.fetch_add(cost_cents, Ordering::Relaxed);
    }

    pub fn get_metrics(&self) -> Metrics {
        let session_duration = self
            .session_start
            .read()
            .unwrap()
            .map(|start| start.elapsed().as_secs())
            .unwrap_or(0);

        Metrics {
            total_input_tokens: self.total_input_tokens.load(Ordering::Relaxed),
            total_output_tokens: self.total_output_tokens.load(Ordering::Relaxed),
            total_tokens: self.total_input_tokens.load(Ordering::Relaxed)
                + self.total_output_tokens.load(Ordering::Relaxed),
            total_cost_dollars: self.total_cost_cents.load(Ordering::Relaxed) as f64 / 100.0,
            session_duration_secs: session_duration,
        }
    }

    pub fn reset(&self) {
        self.total_input_tokens.store(0, Ordering::Relaxed);
        self.total_output_tokens.store(0, Ordering::Relaxed);
        self.total_cost_cents.store(0, Ordering::Relaxed);
        *self.session_start.write().unwrap() = Some(std::time::Instant::now());
    }
}

impl Default for MetricsTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metrics {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_tokens: u64,
    pub total_cost_dollars: f64,
    pub session_duration_secs: u64,
}
