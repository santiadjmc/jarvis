import { Agent, fetch as undiciFetch } from "undici";
import type {
    OllamaChatOptions,
    OllamaGenerateOptions,
    OllamaModelInfo,
    OllamaEmbeddingResponse,
    OllamaMessage,
    OllamaToolCall,
} from "../types/ai";
import { getAIConfig } from "./config";
import Log from "../Log";

type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

export function streamDelta(value: string, emitted: string): string {
    if (!value) return "";
    if (value.startsWith(emitted)) return value.slice(emitted.length);
    if (emitted.endsWith(value)) return "";
    return value;
}

export interface ChatStreamChunk {
    content: string;
    thinking: string;
    done: boolean;
    toolCalls?: OllamaToolCall[];
}

interface PendingToolCall {
    id?: string;
    name: string;
    args: string;
}

function toWireMessage(msg: OllamaMessage): Record<string, unknown> {
    const wire: Record<string, unknown> = { role: msg.role };

    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        wire.content = msg.content || null;
        wire.tool_calls = msg.tool_calls.map((call, i) => ({
            id: call.id || `call_${i}`,
            type: "function",
            function: {
                name: call.function.name,
                arguments: JSON.stringify(call.function.arguments ?? {}),
            },
        }));
        return wire;
    }

    wire.content = msg.content ?? "";
    if (msg.role === "tool") {
        wire.tool_call_id = msg.tool_call_id || msg.tool_name || "unknown";
        if (msg.tool_name) wire.name = msg.tool_name;
    }
    return wire;
}

function finalizeToolCalls(pending: Map<number, PendingToolCall>): OllamaToolCall[] {
    const out: OllamaToolCall[] = [];
    for (const [index, call] of Array.from(pending.entries()).sort((a, b) => a[0] - b[0])) {
        let parsedArgs: Record<string, unknown> = {};
        if (call.args.trim()) {
            try {
                parsedArgs = JSON.parse(call.args);
            } catch {
                Log.warn("Failed to parse streamed tool call arguments", { name: call.name, raw: call.args.slice(0, 200) });
            }
        }
        out.push({
            id: call.id || `call_${index}`,
            type: "function",
            function: { name: call.name, arguments: parsedArgs },
        });
    }
    return out;
}

class LLMClient {
    private baseUrl: string;
    private nativeBaseUrl: string;
    private apiKey: string;
    private defaultModel: string;
    private embeddingModel: string;
    private timeout: number;
    private dispatcher: Agent;
    private ollamaNative: boolean | null = null;

    constructor() {
        const cfg = getAIConfig();
        this.baseUrl = cfg.baseUrl;
        this.nativeBaseUrl = cfg.nativeBaseUrl;
        this.apiKey = cfg.apiKey;
        this.defaultModel = cfg.defaultModel;
        this.embeddingModel = cfg.embeddingModel;
        this.timeout = Number.isFinite(cfg.timeoutMs) && cfg.timeoutMs > 0 ? cfg.timeoutMs : 120000;
        this.dispatcher = new Agent({ headersTimeout: this.timeout, bodyTimeout: this.timeout });
    }

    async chat(options: OllamaChatOptions): Promise<string> {
        const response = await this.request(`${this.baseUrl}/chat/completions`, this.buildChatBody(options, false), "POST", options.signal);
        const data = await response.json() as any;
        return data.choices?.[0]?.message?.content || "";
    }

    async *chatStream(options: OllamaChatOptions): AsyncGenerator<ChatStreamChunk> {
        const response = await this.request(`${this.baseUrl}/chat/completions`, this.buildChatBody(options, true), "POST", options.signal);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        const pendingCalls = new Map<number, PendingToolCall>();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line || !line.startsWith("data:")) continue;

                const payload = line.slice(5).trim();
                if (payload === "[DONE]") continue;

                let chunk: any;
                try {
                    chunk = JSON.parse(payload);
                } catch {
                    continue;
                }

                const choice = chunk.choices?.[0];
                const delta = choice?.delta || {};
                const content: string = delta.content || "";
                const thinking: string = delta.reasoning_content || delta.reasoning || "";

                if (Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                        const idx = typeof tc.index === "number" ? tc.index : 0;
                        const existing = pendingCalls.get(idx) || { name: "", args: "" };
                        if (tc.id) existing.id = tc.id;
                        if (tc.function?.name) existing.name = tc.function.name;
                        if (tc.function?.arguments) existing.args += tc.function.arguments;
                        pendingCalls.set(idx, existing);
                    }
                }

                const finished = choice?.finish_reason != null;
                const result: ChatStreamChunk = { content, thinking, done: false };
                if (finished && pendingCalls.size > 0) {
                    result.toolCalls = finalizeToolCalls(pendingCalls);
                }

                if (content || thinking || result.toolCalls) {
                    yield result;
                }
            }
        }
    }

    async generate(options: OllamaGenerateOptions): Promise<string> {
        const messages: OllamaMessage[] = [];
        if (options.system) messages.push({ role: "system", content: options.system });
        messages.push({ role: "user", content: options.prompt });
        return this.chat({ model: options.model, messages, options: options.options, signal: options.signal });
    }

    async embed(texts: string[]): Promise<number[][]> {
        const response = await this.nativeRequest("/api/embed", {
            model: this.embeddingModel,
            input: texts,
            keep_alive: 300,
        });
        const data = await response.json() as OllamaEmbeddingResponse;
        return data.embeddings;
    }

    async embedSingle(text: string): Promise<number[]> {
        const results = await this.embed([text]);
        return results[0];
    }

    async listModels(): Promise<OllamaModelInfo[]> {
        const response = await this.nativeRequest("/api/tags", undefined, "GET");
        const data = await response.json() as any;
        return data.models || [];
    }

    async getLoadedModels(): Promise<string[]> {
        try {
            const response = await this.nativeRequest("/api/ps", undefined, "GET");
            const data = await response.json() as any;
            return (data.models || []).map((m: { name: string }) => m.name);
        } catch {
            return [];
        }
    }

    async isModelLoaded(model?: string): Promise<boolean> {
        const target = model || this.defaultModel;
        const loaded = await this.getLoadedModels();
        return loaded.some(m => m === target || m.startsWith(`${target}:`));
    }

    async warmup(model?: string): Promise<number> {
        const target = model || this.defaultModel;
        const startedAt = Date.now();
        try {
            await this.nativeRequest("/api/generate", {
                model: target,
                prompt: "",
                stream: false,
                keep_alive: -1,
                options: { num_predict: 0 },
            });
            return Date.now() - startedAt;
        } catch (err: any) {
            Log.warn(`Failed to warm up model ${target}`, { error: err.message, model: target });
            return -1;
        }
    }

    async warmupEmbedding(): Promise<number> {
        const startedAt = Date.now();
        try {
            await this.nativeRequest("/api/embed", {
                model: this.embeddingModel,
                input: ["warmup"],
                keep_alive: 300,
            });
            return Date.now() - startedAt;
        } catch (err: any) {
            Log.warn(`Failed to warm up embedding model ${this.embeddingModel}`, { error: err.message, model: this.embeddingModel });
            return -1;
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await this.request(`${this.baseUrl}/models`, undefined, "GET");
            return response.ok;
        } catch {
            try {
                const response = await this.nativeRequest("/api/tags", undefined, "GET");
                return response.ok;
            } catch {
                return false;
            }
        }
    }

    async isOllamaNative(): Promise<boolean> {
        if (this.ollamaNative !== null) return this.ollamaNative;
        try {
            const response = await this.nativeRequest("/api/tags", undefined, "GET");
            const data = await response.json() as any;
            this.ollamaNative = Array.isArray(data?.models);
        } catch {
            this.ollamaNative = false;
        }
        return this.ollamaNative;
    }

    getDefaultModel(): string {
        return this.defaultModel;
    }

    getEmbeddingModel(): string {
        return this.embeddingModel;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    private buildChatBody(options: OllamaChatOptions, stream: boolean): Record<string, unknown> {
        const body: Record<string, unknown> = {
            model: options.model || this.defaultModel,
            messages: options.messages.map(toWireMessage),
            stream,
        };
        if (options.tools && options.tools.length > 0) body.tools = options.tools;
        if (options.options?.temperature !== undefined) body.temperature = options.options.temperature;
        if (options.options?.top_p !== undefined) body.top_p = options.options.top_p;
        if (options.options?.num_predict !== undefined) body.max_tokens = options.options.num_predict;
        if (options.options?.stop !== undefined) body.stop = options.options.stop;
        if (options.options?.seed !== undefined) body.seed = options.options.seed;
        return body;
    }

    private async request(url: string, body?: unknown, method: "GET" | "POST" = "POST", signal?: AbortSignal): Promise<FetchResponse> {
        return this.rawRequest(url, body, method, signal, true);
    }

    private async nativeRequest(endpoint: string, body?: unknown, method: "GET" | "POST" = "POST", signal?: AbortSignal): Promise<FetchResponse> {
        return this.rawRequest(`${this.nativeBaseUrl}${endpoint}`, body, method, signal, false);
    }

    private async rawRequest(url: string, body: unknown, method: "GET" | "POST", signal: AbortSignal | undefined, authenticated: boolean): Promise<FetchResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        const onAbort = () => controller.abort();
        if (signal) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener("abort", onAbort, { once: true });
        }

        try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (authenticated && this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

            const init: Parameters<typeof undiciFetch>[1] = { method, headers, signal: controller.signal, dispatcher: this.dispatcher };
            if (body) init.body = JSON.stringify(body);

            const response = await undiciFetch(url, init);
            if (!response.ok) {
                const text = await response.text().catch(() => "");
                throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 300) || response.statusText}`);
            }
            return response;
        } finally {
            clearTimeout(timeoutId);
            if (signal) signal.removeEventListener("abort", onAbort);
        }
    }
}

const llmClient = new LLMClient();
export default llmClient;
