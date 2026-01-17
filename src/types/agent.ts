export type AgentStatus =
  | "initializing"
  | "idle"
  | "working"
  | "paused"
  | "error"
  | "stopped";

export interface AgentInfo {
  id: string;
  name: string;
  status: AgentStatus;
  session_id: string | null;
  working_directory: string;
  current_file: string | null;
  progress: number;
  tokens_used: number;
  token_limit: number;
  pending_inputs: PendingInput[];
}

export type PendingInputType = "tool_permission" | "user_question" | "confirmation";

export interface PendingInput {
  id: string;
  input_type: PendingInputType;
  tool_name: string | null;
  message: string;
  timestamp: number;
}

export interface AgentUpdate {
  agent_id: string;
  update_type: string;
  message: string | null;
  tool: ToolUpdate | null;
  progress: number | null;
  current_file: string | null;
  status: AgentStatus | null;
  pending_inputs: PendingInput[] | null;
}

export interface ToolUpdate {
  name: string;
  input: Record<string, unknown> | null;
}
