export interface Metrics {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_dollars: number;
  session_duration_secs: number;
}

export interface SessionUpdate {
  session_id: string;
  type: string;
  message?: string;
  tool?: {
    name: string;
    input?: Record<string, unknown>;
  };
  progress?: number;
}
