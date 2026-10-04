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
        jwtSecret: string;
        jwtExpiresIn: string;
        apiKeyPrefix: string;
    };
    ollama: {
        baseUrl: string;
        defaultModel: string;
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
    JWT_SECRET: string;
    JWT_EXPIRES_IN: string;
    API_KEY_PREFIX: string;
    OLLAMA_BASE_URL: string;
    OLLAMA_DEFAULT_MODEL: string;
    OLLAMA_EMBEDDING_MODEL: string;
    OLLAMA_TIMEOUT: number;
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
