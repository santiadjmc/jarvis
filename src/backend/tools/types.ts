import type { ToolCategory } from "../types/agent";

export interface ToolParamJsonSchema {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: unknown[]; default?: unknown }>;
    required?: string[];
}

export interface ToolResult {
    success: boolean;
    data: unknown;
    error?: string;
    executionTimeMs?: number;
}

export interface DeviceToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
    executionTimeMs?: number;
}

export interface ToolContext {
    clientId: string;
    requestId: string;
    targetDeviceId?: string;
}

export interface ToolSpec {
    name: string;
    description: string;
    category: ToolCategory;
    requiresApproval: boolean;
    timeoutMs: number;
    parameters: ToolParamJsonSchema;
    runtime?: "server" | "device";
    capability?: string;
    execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult | Omit<ToolResult, "executionTimeMs">>;
}

export interface ToolResultMessagePayload {
    type: "tool_result";
    id: string;
    requestId: string;
    tool: string;
    callId: string;
    success: boolean;
    data?: unknown;
    error?: string;
}