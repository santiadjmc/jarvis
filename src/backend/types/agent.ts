export interface ToolDefinition {
    name: string;
    description: string;
    parameters: ToolParameter[];
    category: ToolCategory;
    requiresPermission: Permission;
    sandboxed: boolean;
}

export type ToolCategory = "system" | "web" | "file" | "code" | "memory" | "utility";

export type Permission = "tools:execute";

export interface ToolParameter {
    name: string;
    type: "string" | "number" | "boolean" | "array" | "object";
    description: string;
    required: boolean;
    default?: unknown;
}

export interface ToolExecutionRequest {
    tool: string;
    params: Record<string, unknown>;
    requestId: string;
    clientId: string;
    timeout?: number;
}

export interface ToolExecutionResult {
    success: boolean;
    data?: unknown;
    error?: string;
    executionTimeMs: number;
    tool: string;
    requestId: string;
}

export interface AgentTurn {
    reasoning: string;
    toolCalls?: ToolCall[];
    response?: string;
    done: boolean;
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface AgentConfig {
    maxTurns: number;
    maxTokens: number;
    temperature: number;
    systemPrompt: string;
    enabledTools: string[];
}

export interface MemoryEntry {
    id: string;
    content: string;
    type: "conversation" | "fact" | "summary" | "embedding";
    metadata: Record<string, unknown>;
    createdAt: number;
    expiresAt?: number;
}
