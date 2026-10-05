import "dotenv/config";
import figlet from "figlet";
import Server from "./server";
import aiOrchestrator from "./ai";
import conversationManager from "./ai/ConversationManager";
import modelManager from "./ai/ModelManager";
import messageRouter from "./server/ws/MessageRouter";
import connectionManager from "./server/ws/ConnectionManager";
import deviceRegistry from "./server/ws/DeviceRegistry";
import streamManager from "./server/ws/StreamManager";
import approvalBroker from "./tools/ApprovalBroker";
import resultBroker from "./tools/ResultBroker";
import llmClient from "./ai/LLMClient";
import { getAIConfig } from "./ai/config";
import cacheManager from "./managers/CacheManager";
import ttsService from "./voice/TtsService";
import { getLocalAddresses } from "./utils/network";
import Log from "./Log";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function boot(): Promise<void> {
    console.log("");
    try {
        console.log(figlet.textSync("JARVIS", { font: "Standard" }));
    } catch {
        console.log("JARVIS");
    }
    console.log("═".repeat(50));

    Log.info("Booting Jarvis...");

    try {
        await cacheManager.initialize();
        Log.info("Cache initialized");
    } catch (err: any) {
        Log.warn("Cache init failed, continuing without cache", { error: err.message });
    }

    conversationManager.start();

    await ttsService.init();

    messageRouter.setAIHandler((client, message) => aiOrchestrator.handleChat(client, message));

    messageRouter.register("speak", (client, message) => {
        if (message.type !== "speak") return;
        void (async () => {
            try {
                const synth = await ttsService.synthesize(message.text);
                if (!synth) {
                    connectionManager.send(client.id, JSON.stringify({
                        type: "error",
                        id: crypto.randomUUID(),
                        code: "TTS_UNAVAILABLE",
                        message: "Text-to-speech is not available.",
                        requestId: message.id,
                    }));
                    return;
                }
                connectionManager.send(client.id, JSON.stringify({
                    type: "voice",
                    id: crypto.randomUUID(),
                    requestId: message.id,
                    seq: 1,
                    final: true,
                    audio: synth.audio.toString("base64"),
                    format: synth.format,
                    sampleRate: synth.sampleRate,
                }));
            } catch (err: any) {
                Log.warn("Speak synthesis failed", { error: err.message });
            }
        })();
    });

    messageRouter.register("ping", (client, message) => {
        if (message.type !== "ping") return;
        connectionManager.send(client.id, JSON.stringify({
            type: "pong",
            id: message.id,
            timestamp: message.timestamp,
            serverTime: Date.now(),
        }));
    });

    messageRouter.register("cancel", (client, message) => {
        if (message.type === "cancel") {
            aiOrchestrator.cancelStream(message.requestId);
        }
    });

    messageRouter.register("tool_response", (client, message) => {
        if (message.type === "tool_response") {
            const resolved = approvalBroker.resolve(message.requestId, message.callId, message.action);
            Log.info("Tool response received", {
                clientId: client.id,
                requestId: message.requestId,
                callId: message.callId,
                action: message.action,
                resolved,
            });
        }
    });

    messageRouter.register("device_hello", (client, message) => {
        if (message.type !== "device_hello") return;
        deviceRegistry.upsert(client.id, {
            deviceId: message.deviceId,
            deviceName: message.deviceName || "",
            deviceType: message.deviceType || "",
            capabilities: message.capabilities || [],
        });
        client.metadata.deviceId = message.deviceId;
        client.metadata.deviceName = message.deviceName || message.deviceId.slice(0, 8);
        client.metadata.deviceType = message.deviceType || "unknown";
        client.metadata.capabilities = message.capabilities || [];
        Log.info("Device hello", {
            clientId: client.id,
            deviceId: message.deviceId,
            deviceName: client.metadata.deviceName,
            deviceType: client.metadata.deviceType,
            capabilityCount: (message.capabilities || []).length,
        });
    });

    messageRouter.register("tool_execute_result", (client, message) => {
        if (message.type !== "tool_execute_result") return;
        const deviceId = deviceRegistry.getDeviceId(client.id);
        const resolved = resultBroker.resolve(client.id, message.requestId, message.callId, {
            success: message.success,
            data: message.data,
            error: message.error,
            executionTimeMs: message.executionTimeMs,
        }, deviceId);
        Log.info("Device tool result received", {
            clientId: client.id,
            requestId: message.requestId,
            callId: message.callId,
            success: message.success,
            resolved,
        });
    });

    messageRouter.register("config", (client, message) => {
        if (message.type === "config") {
            handleConfigMessage(client, message);
        }
    });

    const server = new Server(PORT, HOST);
    await server.start();

    setInterval(() => {
        const cleaned = streamManager.cleanupStale();
        if (cleaned > 0) Log.warn("Swept stale streams", { count: cleaned });
    }, 60_000);

    const aiConfig = getAIConfig();
    const llmAvailable = await llmClient.isAvailable();
    if (llmAvailable) {
        Log.info("LLM endpoint connection verified", { baseUrl: aiConfig.baseUrl });
        await modelManager.syncWithOllama();

        const activeModel = modelManager.getActive();
        Log.info(`Loading ${activeModel} into memory...`, { model: activeModel });
        const chatWarmupMs = await llmClient.warmup(activeModel);
        if (chatWarmupMs > 0) Log.info("Chat model warm", { model: activeModel, loadMs: chatWarmupMs });

        startKeepWarmWatchdog();
    } else {
        Log.warn("LLM endpoint not reachable - AI features will not work until it is started", {
            baseUrl: aiConfig.baseUrl,
        });
    }

    Log.info("Jarvis is online", {
        port: PORT,
        host: HOST,
        lan: getLocalAddresses().ipv4,
        llm: llmAvailable ? "connected" : "disconnected",
        baseUrl: aiConfig.baseUrl,
        model: modelManager.getActive(),
    });

    process.on("SIGINT", async () => {
        Log.info("Shutting down Jarvis...");
        conversationManager.stop();
        await cacheManager.shutdown();
        await server.stop();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        Log.info("Shutting down Jarvis...");
        conversationManager.stop();
        await cacheManager.shutdown();
        await server.stop();
        process.exit(0);
    });
}

function handleConfigMessage(client: { id: string }, message: { id: string; action: string; key: string; value?: unknown }): void {
    if (message.action === "get") {
        let value: unknown;
        switch (message.key) {
            case "model":
                value = modelManager.getActive();
                break;
            case "models":
                value = modelManager.list();
                break;
            case "sessions":
                value = conversationManager.getStats();
                break;
            default:
                connectionManager.send(client.id, JSON.stringify({
                    type: "error",
                    id: message.id,
                    code: "UNKNOWN_CONFIG",
                    message: `Unknown config key: ${message.key}`,
                }));
                return;
        }
        connectionManager.send(client.id, JSON.stringify({
            type: "config_response",
            id: message.id,
            key: message.key,
            value,
        }));
    } else if (message.action === "set") {
        if (message.key === "model" && typeof message.value === "string") {
            modelManager.set(message.value);
            connectionManager.send(client.id, JSON.stringify({
                type: "config_response",
                id: message.id,
                key: message.key,
                value: message.value,
            }));
        }
    }
}

let lastWarmupAttemptAt = 0;

function startKeepWarmWatchdog(): void {
    const CHECK_INTERVAL = 60_000;

    setInterval(async () => {
        const model = modelManager.getActive();
        const loaded = await llmClient.isModelLoaded(model).catch(() => false);
        if (loaded) return;

        const now = Date.now();
        if (now - lastWarmupAttemptAt < 30_000) return;

        lastWarmupAttemptAt = now;
        Log.warn(`Model ${model} no longer loaded, reloading into memory`, { model });
        const ms = await llmClient.warmup(model);
        if (ms > 0) Log.info("Chat model re-warmed", { model, loadMs: ms });
    }, CHECK_INTERVAL);
}

boot().catch((err) => {
    Log.error("Fatal boot error", err);
    process.exit(1);
});
