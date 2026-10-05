export interface OllamaGenerateOptions {
    model: string;
    prompt: string;
    system?: string;
    context?: number[];
    stream?: boolean;
    options?: OllamaModelOptions;
    signal?: AbortSignal;
}

export interface OllamaChatOptions {
    model: string;
    messages: OllamaMessage[];
    stream?: boolean;
    options?: OllamaModelOptions;
    tools?: OllamaTool[];
    signal?: AbortSignal;
    keepAlive?: number;
}

export interface OllamaModelOptions {
    num_ctx?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    seed?: number;
    num_predict?: number;
    stop?: string[];
}

export interface OllamaMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    images?: string[];
    tool_calls?: OllamaToolCall[];
    tool_name?: string;
    tool_call_id?: string;
}

export interface OllamaTool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface OllamaToolCall {
    id?: string;
    type: "function";
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

export interface OllamaStreamChunk {
    model?: string;
    created_at?: string;
    message?: {
        role: string;
        content: string;
        thinking?: string;
        tool_calls?: OllamaToolCall[];
    };
    response?: string;
    context?: number[];
    done: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

export interface OllamaLoadedModel {
    name: string;
    model: string;
    size: number;
    digits: string;
    processor: string;
    context: number;
    expires_at: string;
}

export interface OllamaEmbeddingResponse {
    embeddings: number[][];
}

export interface OllamaModelInfo {
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
        format: string;
        family: string;
        families: string[];
        parameter_size: string;
        quantization_level: string;
    };
}

export interface ConversationMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    timestamp: number;
    model?: string;
    toolCalls?: OllamaToolCall[];
    toolResults?: unknown[];
    tool_name?: string;
    tool_call_id?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
}

export interface Conversation {
    id: string;
    sessionId: string;
    clientId: string;
    messages: ConversationMessage[];
    systemPrompt: string;
    model: string;
    createdAt: number;
    updatedAt: number;
}

export interface EmbeddingEntry {
    id: string;
    content: string;
    embedding: number[];
    metadata: Record<string, unknown>;
    createdAt: number;
}
