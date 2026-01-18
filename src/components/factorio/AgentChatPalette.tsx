import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAgentStore } from "../../stores/agentStore";
import type { AgentInfo } from "../../types";

interface AgentChatPaletteProps {
  agent: AgentInfo;
  onClose: () => void;
  respondedInputIds: Set<string>;
  onInputResponded: (inputId: string) => void;
}

export function AgentChatPalette({ agent, onClose, respondedInputIds, onInputResponded }: AgentChatPaletteProps) {
  const [input, setInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const activityLog = useAgentStore((s) => s.activityLog);
  const sendPrompt = useAgentStore((s) => s.sendPrompt);

  // Filter activity log for this agent
  const agentMessages = activityLog.filter((entry) => entry.agentId === agent.id);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [agentMessages.length]);

  // Focus input on mount and when agent changes
  useEffect(() => {
    // Use setTimeout to ensure focus happens after render cycle
    const timeoutId = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timeoutId);
  }, [agent.id]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isExecuting) return;

    const prompt = input.trim();
    setInput("");
    setIsExecuting(true);

    try {
      await sendPrompt(agent.id, prompt);
    } catch (error) {
      console.error("Failed to send prompt:", error);
    } finally {
      setIsExecuting(false);
      inputRef.current?.focus();
    }
  }, [input, isExecuting, agent.id, sendPrompt]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  const handlePermissionResponse = useCallback(async (inputId: string, approved: boolean) => {
    // Immediately hide the input
    onInputResponded(inputId);

    try {
      await invoke("respond_to_permission", {
        agentId: agent.id,
        inputId,
        approved,
        optionId: null,
      });
    } catch (error) {
      console.error("Failed to respond to permission:", error);
    }
  }, [agent.id, onInputResponded]);

  const getInputTypeLabel = (type: string): string => {
    switch (type) {
      case "tool_permission":
        return "Permission Request";
      case "user_question":
        return "Question";
      case "confirmation":
        return "Confirmation";
      default:
        return "Input Required";
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "working":
        return "#4ade80";
      case "idle":
        return "#60a5fa";
      case "error":
        return "#ef4444";
      default:
        return "#9ca3af";
    }
  };

  return (
    <div className="agent-chat-palette" onClick={(e) => e.stopPropagation()}>
      <div className="agent-chat-palette__header">
        <div className="agent-chat-palette__title">
          <span
            className="agent-chat-palette__status-dot"
            style={{ backgroundColor: getStatusColor(agent.status) }}
          />
          <span className="agent-chat-palette__name">{agent.name}</span>
        </div>
        <button className="agent-chat-palette__close" onClick={onClose}>
          ×
        </button>
      </div>

      {/* Pending Inputs Section */}
      {agent.pending_inputs && agent.pending_inputs.filter(p => !respondedInputIds.has(p.id)).length > 0 && (
        <div className="agent-chat-palette__pending">
          {agent.pending_inputs.filter(p => !respondedInputIds.has(p.id)).map((pendingInput) => (
            <div key={pendingInput.id} className="agent-chat-palette__pending-item">
              <div className="agent-chat-palette__pending-label">
                {getInputTypeLabel(pendingInput.input_type)}
              </div>
              <div className="agent-chat-palette__pending-message">
                {pendingInput.message}
              </div>
              {pendingInput.tool_name && (
                <div className="agent-chat-palette__pending-tool">
                  Tool: {pendingInput.tool_name}
                </div>
              )}
              <div className="agent-chat-palette__pending-actions">
                <button
                  className="agent-chat-palette__btn agent-chat-palette__btn--approve"
                  onClick={() => handlePermissionResponse(pendingInput.id, true)}
                >
                  Approve
                </button>
                <button
                  className="agent-chat-palette__btn agent-chat-palette__btn--deny"
                  onClick={() => handlePermissionResponse(pendingInput.id, false)}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="agent-chat-palette__messages" ref={messagesRef}>
        {agentMessages.length === 0 ? (
          <div className="agent-chat-palette__empty">
            No messages yet. Start a conversation with this agent.
          </div>
        ) : (
          agentMessages.map((entry) => (
            <div
              key={entry.id}
              className={`agent-chat-palette__message agent-chat-palette__message--${entry.type}`}
            >
              <span className="agent-chat-palette__message-time">
                {formatTime(entry.timestamp)}
              </span>
              <span className="agent-chat-palette__message-content">
                {entry.content}
              </span>
            </div>
          ))
        )}
        {isExecuting && (
          <div className="agent-chat-palette__message agent-chat-palette__message--status">
            <span className="agent-chat-palette__typing">Agent is working...</span>
          </div>
        )}
      </div>

      <div className="agent-chat-palette__input-area">
        <textarea
          ref={inputRef}
          className="agent-chat-palette__input"
          placeholder="Send a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={isExecuting}
        />
        <button
          className="agent-chat-palette__send"
          onClick={handleSend}
          disabled={!input.trim() || isExecuting}
        >
          {isExecuting ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
