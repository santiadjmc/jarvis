import type {
    OllamaChatOptions,
    OllamaGenerateOptions,
    OllamaStreamChunk,
    OllamaModelInfo,
    OllamaEmbeddingResponse,
} from "../types/ai";
import Log from "../Log";

export function streamDelta(value: string, emitted: string): string {
    if (!value) return "";
    if (value.startsWith(emitted)) return value.slice(emitted.length);
    if (emitted.endsWith(value)) return "";
    return value;
}

class OllamaClient {
    private baseUrl: string;
    private defaultModel: string;
    private embeddingModel: string;
    private timeout: number;

    constructor() {
        this.baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
        this.defaultModel = process.env.OLLAMA_DEFAULT_MODEL || "mistral:latest";
        this.embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
        this.timeout = parseInt(process.env.OLLAMA_TIMEOUT || "120000", 10);
    }

    async chat(options: OllamaChatOptions): Promise<string> {
        const response = await this.request("/api/chat", {
            model: options.model || this.defaultModel,
            messages: options.messages,
            stream: false,
            keep_alive: options.keepAlive ?? -1,
            options: options.options,
            tools: options.tools,
        }, "POST", options.signal);
        const data = await response.json();
        return data.message?.content || "";
    }

    async *chatStream(options: OllamaChatOptions): AsyncGenerator<{ content: string; thinking: string; done: boolean; toolCalls?: unknown[] }> {
        const response = await this.request("/api/chat", {
            model: options.model || this.defaultModel,
            messages: options.messages,
            stream: true,
            keep_alive: options.keepAlive ?? -1,
            options: options.options,
            tools: options.tools,
        }, "POST", options.signal);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let emittedContent = "";
        let emittedThinking = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const chunk: OllamaStreamChunk = JSON.parse(line);
                    const content = streamDelta(chunk.message?.content || "", emittedContent);
                    const thinking = streamDelta(chunk.message?.thinking || "", emittedThinking);
                    emittedContent += content;
                    emittedThinking += thinking;
                    const result = {
                        content,
                        thinking,
                        done: chunk.done,
                        toolCalls: chunk.message?.tool_calls,
                    };
                    yield result;
                } catch {}
            }
        }
    }

    async generate(options: OllamaGenerateOptions): Promise<string> {
        const response = await this.request("/api/generate", {
            model: options.model || this.defaultModel,
            prompt: options.prompt,
            system: options.system,
            context: options.context,
            stream: false,
            keep_alive: -1,
            options: options.options,
        }, "POST", options.signal);
        const data = await response.json();
        return data.response || "";
    }

    async *generateStream(options: OllamaGenerateOptions): AsyncGenerator<{ token: string; done: boolean; context?: number[] }> {
        const response = await this.request("/api/generate", {
            model: options.model || this.defaultModel,
            prompt: options.prompt,
            system: options.system,
            context: options.context,
            stream: true,
            keep_alive: -1,
            options: options.options,
        }, "POST", options.signal);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const chunk: OllamaStreamChunk = JSON.parse(line);
                    const result = {
                        token: chunk.response || "",
                        done: chunk.done,
                        context: undefined,
                    };
                    yield result;
                } catch {}
            }
        }
    }

    async embed(texts: string[]): Promise<number[][]> {
        const response = await this.request("/api/embed", {
            model: this.embeddingModel,
            input: texts,
            keep_alive: 300,
        });
        const data: OllamaEmbeddingResponse = await response.json();
        return data.embeddings;
    }

    async embedSingle(text: string): Promise<number[]> {
        const results = await this.embed([text]);
        return results[0];
    }

    async listModels(): Promise<OllamaModelInfo[]> {
        const response = await this.request("/api/tags", undefined, "GET");
        const data = await response.json();
        return data.models || [];
    }

    async getLoadedModels(): Promise<string[]> {
        try {
            const response = await this.request("/api/ps", undefined, "GET");
            const data = await response.json();
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
            await this.request("/api/generate", {
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
            await this.request("/api/embed", {
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
            const response = await this.request("/api/tags", undefined, "GET");
            return response.ok;
        } catch {
            return false;
        }
    }

    getDefaultModel(): string {
        return this.defaultModel;
    }

    getEmbeddingModel(): string {
        return this.embeddingModel;
    }

    private async request(endpoint: string, body?: unknown, method: "GET" | "POST" = "POST", signal?: AbortSignal): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        const onAbort = () => controller.abort();
        if (signal) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener("abort", onAbort, { once: true });
        }

        try {
            const init: RequestInit = {
                method,
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
            };
            if (body) init.body = JSON.stringify(body);

            return await fetch(`${this.baseUrl}${endpoint}`, init);
        } finally {
            clearTimeout(timeoutId);
            if (signal) signal.removeEventListener("abort", onAbort);
        }
    }
}

const ollamaClient = new OllamaClient();
export default ollamaClient;
