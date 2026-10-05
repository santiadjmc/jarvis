import llmClient from "./LLMClient";
import { getAIConfig } from "./config";
import Log from "../Log";

interface ModelConfig {
    name: string;
    displayName: string;
    maxContext: number;
    supportsTools: boolean;
    supportsStreaming: boolean;
    isEmbedding: boolean;
}

class ModelManager {
    private models = new Map<string, ModelConfig>();
    private activeModel: string;
    private deepModel: string;
    private fallbackModels: string[] = [];

    constructor() {
        const cfg = getAIConfig();
        this.activeModel = cfg.defaultModel;
        this.deepModel = cfg.deepModel;
        this.registerDefaults();
    }

    private registerDefaults(): void {
        this.register({
            name: "llama3.2",
            displayName: "Llama 3.2",
            maxContext: 128000,
            supportsTools: true,
            supportsStreaming: true,
            isEmbedding: false,
        });
        this.register({
            name: "llama3.1",
            displayName: "Llama 3.1",
            maxContext: 128000,
            supportsTools: true,
            supportsStreaming: true,
            isEmbedding: false,
        });
        this.register({
            name: "llama3.1:8b",
            displayName: "Llama 3.1 8B",
            maxContext: 128000,
            supportsTools: true,
            supportsStreaming: true,
            isEmbedding: false,
        });
        this.register({
            name: "mistral:latest",
            displayName: "Mistral",
            maxContext: 32000,
            supportsTools: true,
            supportsStreaming: true,
            isEmbedding: false,
        });
        this.register({
            name: "nomic-embed-text",
            displayName: "Nomic Embed Text",
            maxContext: 8192,
            supportsTools: false,
            supportsStreaming: false,
            isEmbedding: true,
        });
    }

    register(config: ModelConfig): void {
        this.models.set(config.name, config);
    }

    set(modelName: string): boolean {
        if (!this.models.has(modelName)) {
            const config: ModelConfig = {
                name: modelName,
                displayName: modelName,
                maxContext: 32000,
                supportsTools: true,
                supportsStreaming: true,
                isEmbedding: false,
            };
            this.register(config);
        }
        this.activeModel = modelName;
        Log.info("Model switched", { model: modelName });
        return true;
    }

    getActive(): string {
        return this.activeModel;
    }

    getDeep(): string {
        return this.deepModel;
    }

    setDeep(modelName: string): void {
        this.deepModel = modelName;
        Log.info("Deep model switched", { model: modelName });
    }

    getConfig(modelName?: string): ModelConfig | undefined {
        return this.models.get(modelName || this.activeModel);
    }

    list(): ModelConfig[] {
        return Array.from(this.models.values()).filter(m => !m.isEmbedding);
    }

    listAll(): ModelConfig[] {
        return Array.from(this.models.values());
    }

    setFallbacks(models: string[]): void {
        this.fallbackModels = models;
    }

    getFallback(): string | undefined {
        return this.fallbackModels.find(m => m !== this.activeModel && this.models.has(m));
    }

    getMaxContext(modelName?: string): number {
        return this.getConfig(modelName)?.maxContext || 32000;
    }

    async syncWithOllama(): Promise<void> {
        try {
            const remoteModels = await llmClient.listModels();
            for (const remote of remoteModels) {
                if (!this.models.has(remote.name)) {
                    this.register({
                        name: remote.name,
                        displayName: remote.name,
                        maxContext: 32000,
                        supportsTools: true,
                        supportsStreaming: true,
                        isEmbedding: remote.name.includes("embed"),
                    });
                }
            }
            Log.info("Model registry synced with Ollama", { count: remoteModels.length });
        } catch (err: any) {
            Log.warn("Failed to sync models from Ollama", { error: err.message });
        }
    }
}

const modelManager = new ModelManager();
export default modelManager;
