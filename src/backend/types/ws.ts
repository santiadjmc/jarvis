import type { WebSocket } from "ws";

export type ClientRole = "user" | "admin" | "service";

export interface AuthenticatedClient {
    id: string;
    ws: WebSocket;
    apiKeyId: string;
    role: ClientRole;
    connectedAt: number;
    lastActivityAt: number;
    isAlive: boolean;
    metadata: Record<string, unknown>;
}

export type ClientMessage =
    | ChatMessage
    | VoiceMessage
    | ToolResponseMessage
    | DeviceHelloMessage
    | ToolExecuteResultMessage
    | SpeakMessage
    | CancelMessage
    | PingMessage
    | ConfigMessage;

export interface ChatMessage {
    type: "chat";
    id: string;
    content: string;
    sessionId?: string;
    model?: string;
    systemPrompt?: string;
    stream?: boolean;
    voice?: boolean;
    timestamp: number;
}

export interface SpeakMessage {
    type: "speak";
    id: string;
    text: string;
    timestamp?: number;
}

export interface VoiceMessage {
    type: "voice";
    id: string;
    sessionId?: string;
    model?: string;
    timestamp: number;
}

export interface ToolResponseMessage {
    type: "tool_response";
    id: string;
    requestId: string;
    callId: string;
    action: "approve" | "deny";
    data?: unknown;
}

export interface DeviceHelloMessage {
    type: "device_hello";
    id: string;
    deviceId: string;
    deviceName?: string;
    deviceType?: string;
    capabilities?: string[];
}

export interface ToolExecuteResultMessage {
    type: "tool_execute_result";
    id: string;
    requestId: string;
    callId: string;
    success: boolean;
    data?: unknown;
    error?: string;
    executionTimeMs?: number;
}

export interface CancelMessage {
    type: "cancel";
    id: string;
    requestId: string;
}

export interface PingMessage {
    type: "ping";
    id: string;
    timestamp: number;
}

export interface ConfigMessage {
    type: "config";
    id: string;
    action: "get" | "set";
    key: string;
    value?: unknown;
}

export type ServerMessage =
    | TokenMessage
    | StreamEndMessage
    | StatusMessage
    | ToolCallMessage
    | ToolResultMessage
    | VoiceResponseMessage
    | ErrorMessage
    | PongMessage
    | ConfigResponseMessage
    | SessionCreatedMessage;

export interface TokenMessage {
    type: "token";
    id: string;
    content: string;
    requestId: string;
    kind?: "assistant" | "thinking";
    proactive?: boolean;
}

export interface StreamEndMessage {
    type: "stream_end";
    id: string;
    requestId: string;
    fullResponse: string;
    usage?: TokenUsage;
    model: string;
    proactive?: boolean;
}

export interface StatusMessage {
    type: "status";
    id: string;
    status: "thinking" | "tool_calling" | "searching" | "generating" | "reasoning" | "idle";
    detail?: string;
    requestId?: string;
}

export interface ToolCallMessage {
    type: "tool_call";
    id: string;
    requestId: string;
    tool: string;
    callId: string;
    params: Record<string, unknown>;
    approvalRequired: boolean;
    executor?: "server" | "device";
}

export interface ToolResultMessage {
    type: "tool_result";
    id: string;
    requestId: string;
    tool: string;
    callId: string;
    success: boolean;
    data?: unknown;
    error?: string;
}

export interface VoiceResponseMessage {
    type: "voice";
    id: string;
    requestId: string;
    seq: number;
    final: boolean;
    audio?: string;
    format?: "pcm" | "opus" | "wav";
    sampleRate?: number;
}

export interface ErrorMessage {
    type: "error";
    id: string;
    code: string;
    message: string;
    requestId?: string;
}

export interface PongMessage {
    type: "pong";
    id: string;
    timestamp: number;
    serverTime: number;
}

export interface ConfigResponseMessage {
    type: "config_response";
    id: string;
    key: string;
    value: unknown;
}

export interface SessionCreatedMessage {
    type: "session_created";
    id: string;
    sessionId: string;
}

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface ActiveStream {
    requestId: string;
    clientId: string;
    sessionId: string;
    model: string;
    startedAt: number;
    abortController: AbortController;
    fullResponse: string;
}
