export interface AIConfig {
    baseUrl: string;
    nativeBaseUrl: string;
    apiKey: string;
    defaultModel: string;
    deepModel: string;
    embeddingModel: string;
    timeoutMs: number;
}

function trimTrailingSlash(url: string): string {
    return url.replace(/\/+$/, "");
}

export function getAIConfig(): AIConfig {
    const explicitBase = process.env.AI_BASE_URL?.trim();
    const legacyNative = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
    const baseUrl = explicitBase ? trimTrailingSlash(explicitBase) : `${trimTrailingSlash(legacyNative)}/v1`;

    const explicitNative = process.env.OLLAMA_BASE_URL?.trim();
    const nativeBaseUrl = explicitNative ? trimTrailingSlash(explicitNative) : baseUrl.replace(/\/v1\/?$/, "");

    const defaultModel = process.env.AI_MODEL?.trim() || process.env.OLLAMA_DEFAULT_MODEL?.trim() || "llama3.2";
    const deepModel = process.env.AI_DEEP_MODEL?.trim() || process.env.OLLAMA_DEEP_MODEL?.trim() || defaultModel;

    return {
        baseUrl,
        nativeBaseUrl,
        apiKey: process.env.AI_API_KEY?.trim() || "ollama",
        defaultModel,
        deepModel,
        embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL?.trim() || "nomic-embed-text",
        timeoutMs: parseInt(process.env.AI_TIMEOUT || process.env.OLLAMA_TIMEOUT || "120000", 10),
    };
}
