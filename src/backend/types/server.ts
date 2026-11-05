export interface ServerConfig {
    port: number;
    host: string;
    corsOrigins: string[];
    ws: {
        maxPayload: number;
        heartbeatIntervalMs: number;
        clientTimeoutMs: number;
    };
    auth: {
        apiKeyPrefix: string;
    };
    ai: {
        baseUrl: string;
        apiKey: string;
        defaultModel: string;
        deepModel: string;
        embeddingModel: string;
        timeout: number;
    };
    tts: {
        enabled: boolean;
        engine: "piper" | "elevenlabs" | "edge";
        voice: string;
        speed: number;
    };
}

export interface EnvironmentConfig {
    PORT: number;
    HOST: string;
    CORS_ORIGINS: string;
    API_KEY_PREFIX: string;
    AI_BASE_URL: string;
    AI_API_KEY: string;
    AI_MODEL: string;
    AI_DEEP_MODEL: string;
    OLLAMA_EMBEDDING_MODEL: string;
    AI_TIMEOUT: number;
    TTS_ENABLED: boolean;
    TTS_ENGINE: "piper" | "elevenlabs" | "edge";
    TTS_VOICE: string;
    TTS_SPEED: number;
    REDIS_URL: string;
    MYSQL_HOST: string;
    MYSQL_PORT: number;
    MYSQL_USER: string;
    MYSQL_PASSWORD: string;
    MYSQL_DATABASE: string;
}
