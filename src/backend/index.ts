import "./loadEnv";
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
import { listDueTasks } from "./agent/Scheduler/taskStore";
import { isAutoApproveEnabled, setAutoApprove } from "./agent/runtimeConfig";
import { status as googleStatus, isConfigured as googleConfigured } from "./agent/Google/googleAuth";
import { getLocalAddresses } from "./utils/network";
import Log from "./Log";
import { v4 as uuid } from "uuid";

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

    startProactiveScheduler();
    startGoogleAuthWatchdog();

    const aiConfig = getAIConfig();
    const llmAvailable = await llmClient.isAvailable();
    if (llmAvailable) {
        Log.info("LLM endpoint connection verified", { baseUrl: aiConfig.baseUrl });
        const isOllama = await llmClient.isOllamaNative();

        if (isOllama) {
            await modelManager.syncWithOllama();

            const activeModel = modelManager.getActive();
            Log.info(`Loading ${activeModel} into memory...`, { model: activeModel });
            const chatWarmupMs = await llmClient.warmup(activeModel);
            if (chatWarmupMs > 0) Log.info("Chat model warm", { model: activeModel, loadMs: chatWarmupMs });

            startKeepWarmWatchdog();
        } else {
            Log.info("Non-Ollama OpenAI-compatible endpoint detected; skipping model warm-up and keep-alive management", {
                baseUrl: aiConfig.baseUrl,
            });
        }
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
            case "autoApprove":
                value = isAutoApproveEnabled();
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
        } else if (message.key === "autoApprove" && typeof message.value === "boolean") {
            setAutoApprove(message.value);
            Log.info("Autonomous mode changed", { autoApprove: message.value, byClient: client.id });
            connectionManager.broadcast(JSON.stringify({
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

function startProactiveScheduler(): void {
    const CHECK_INTERVAL = 20_000;
    let running = false;

    setInterval(async () => {
        if (running) return;
        const due = listDueTasks();
        if (due.length === 0) return;

        running = true;
        try {
            for (const task of due) {
                Log.info("Running proactive task", { taskId: task.id, instructions: task.instructions });
                await aiOrchestrator.runProactiveTask(task);
            }
        } catch (err: any) {
            Log.error("Proactive scheduler iteration failed", err);
        } finally {
            running = false;
        }
    }, CHECK_INTERVAL);
}

function startGoogleAuthWatchdog(): void {
    const CHECK_INTERVAL = 60 * 60 * 1000;
    const NUDGE_WITHIN_DAYS = 1;
    let lastNudgeAt = 0;

    setInterval(() => {
        if (!googleConfigured()) return;
        const info = googleStatus();
        if (!info.connected || info.expiresInDays === null) return;
        if (info.expiresInDays > NUDGE_WITHIN_DAYS) return;
        if (Date.now() - lastNudgeAt < 20 * 60 * 60 * 1000) return;

        lastNudgeAt = Date.now();
        const streamId = uuid();
        const text = info.expiresInDays <= 0
            ? "Heads up — my connection to your Google account just expired. Open /oauth/google/start in a browser whenever you get a chance to reconnect it."
            : `Heads up — my connection to your Google account expires in about ${info.expiresInDays} day${info.expiresInDays === 1 ? "" : "s"}. Open /oauth/google/start in a browser to reconnect it before then.`;
        connectionManager.broadcast(JSON.stringify({ type: "token", id: uuid(), content: text, requestId: streamId, kind: "assistant", proactive: true }));
        connectionManager.broadcast(JSON.stringify({ type: "stream_end", id: uuid(), requestId: streamId, fullResponse: text, model: "system", proactive: true }));
        Log.info("Google auth expiry nudge sent", { expiresInDays: info.expiresInDays });
    }, CHECK_INTERVAL);
}

boot().catch((err) => {
    Log.error("Fatal boot error", err);
    process.exit(1);
});
