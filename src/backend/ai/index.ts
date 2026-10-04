import { v4 as uuid } from "uuid";
import type { AuthenticatedClient, TokenMessage, StreamEndMessage, StatusMessage } from "../types/ws";
import type { ConversationMessage, OllamaToolCall } from "../types/ai";
import ollamaClient from "./OllamaClient";
import conversationManager from "./ConversationManager";
import promptBuilder from "./PromptBuilder";
import modelManager from "./ModelManager";
import modelRouter, { RouteTier } from "./ModelRouter";
import streamManager from "../server/ws/StreamManager";
import connectionManager from "../server/ws/ConnectionManager";
import deviceRegistry from "../server/ws/DeviceRegistry";
import toolRegistry from "../tools/registry";
import approvalBroker from "../tools/ApprovalBroker";
import resultBroker from "../tools/ResultBroker";
import ttsService from "../voice/TtsService";
import type { ToolResult } from "../tools/types";
import { searchMemory } from "../agent/Memory/memoryStore";
import Log from "../Log";

const APPROVAL_TIMEOUT_MS = 60000;
const DEVICE_TOOL_TIMEOUT_MS = 90000;

function maxToolTurns(): number {
    const parsed = parseInt(process.env.JARVIS_MAX_TOOL_TURNS || "6", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
}

function autoApprove(): boolean {
    return ["1", "true", "yes"].includes((process.env.JARVIS_AUTO_APPROVE || "").toLowerCase());
}

class AIOrchestrator {
    private readonly DEFAULT_SYSTEM_PROMPT = `You are Jarvis, a highly capable AI assistant inspired by the AI from Iron Man.
You are intelligent, precise, and proactive. You speak with confidence and clarity.
You have access to tools to accomplish tasks. Never ask the user for permission or confirmation to use a tool: decide, call it, and report the result. Only ask when a decision genuinely requires user input such as a preference or choice.
Be concise unless detail is requested. Always aim to be maximally helpful.`;

    private voiceRequests = new Set<string>();

    async handleChat(client: AuthenticatedClient, message: any): Promise<void> {
        const requestId = message.id as string;
        const route = await modelRouter.route(message.content || "", message.model);
        const model = route.model;
        const keepAlive = route.tier === "deep" ? 0 : -1;
        const systemPrompt = message.systemPrompt || this.DEFAULT_SYSTEM_PROMPT;

        const identity = (client.metadata?.deviceId as string | undefined) || client.id;

        const conversation = conversationManager.getOrCreate(
            identity,
            message.sessionId || `session-${identity}`,
            systemPrompt,
            model,
        );

        conversationManager.addMessage(conversation.id, {
            role: "user",
            content: message.content,
            timestamp: Date.now(),
            model,
        });

        if (message.voice === true) this.voiceRequests.add(requestId);

        const shouldStream = message.stream !== false;

        if (shouldStream) {
            const abort = new AbortController();
            const streamId = streamManager.create(client.id, conversation.id, model, abort, requestId);
            this.sendStatus(client.id, "thinking", streamId);
            await this.runAgent(client, conversation.id, model, keepAlive, route.tier, streamId, abort);
        } else {
            this.sendStatus(client.id, "thinking", requestId);
            await this.generateResponse(client, conversation.id, requestId, model, keepAlive);
        }
    }

    private async runAgent(
        client: AuthenticatedClient,
        conversationId: string,
        model: string,
        keepAlive: number,
        tier: RouteTier,
        existingStreamId?: string,
        existingAbort?: AbortController,
    ): Promise<void> {
        const abortController = existingAbort ?? new AbortController();
        const streamId = existingStreamId ?? streamManager.create(client.id, conversationId, model, abortController);
        const turns = maxToolTurns();
        const toolDefs = toolRegistry.defsForOllama();
        const approvalsAuto = autoApprove();

        this.sendStatus(client.id, tier === "deep" ? "reasoning" : "generating", streamId);

        if (tier === "deep") {
            this.sendBridgeMessage(client.id, streamId);
        }

        try {
            const conversation = conversationManager.get(conversationId);
            if (conversation) {
                await this.ensureCompacted(conversation, model, abortController.signal);
            }

            for (let turn = 0; turn < turns; turn++) {
                if (abortController.signal.aborted) {
                    streamManager.complete(streamId);
                    return;
                }

                const conversation = conversationManager.get(conversationId);
                if (!conversation) {
                    streamManager.complete(streamId);
                    this.sendError(client.id, "CONVERSATION_NOT_FOUND", "Conversation not found", streamId);
                    return;
                }

                this.sendStatus(client.id, turn === 0 ? (tier === "deep" ? "reasoning" : "generating") : "generating", streamId);

                let systemPrompt = conversation.systemPrompt;
                if (turn === 0) {
                    const latest = conversationManager.getLatestUserMessage(conversationId);
                    const recall = latest ? await this.recallMemories(latest) : "";
                    if (recall) {
                        systemPrompt = `${conversation.systemPrompt}\n\n${recall}`;
                    }
                }

                const messages = promptBuilder.buildAgentMessages(conversation.messages, toolDefs, systemPrompt);

                let assistantContent = "";
                let sawToolCalls = false;
                let toolCalls: OllamaToolCall[] = [];

                const tokenStream = ollamaClient.chatStream({
                    model,
                    messages,
                    stream: true,
                    signal: abortController.signal,
                    keepAlive,
                    tools: toolDefs,
                });

                for await (const chunk of tokenStream) {
                    if (abortController.signal.aborted) break;

                    if (chunk.thinking) {
                        const thinkingMsg: TokenMessage = {
                            type: "token",
                            id: uuid(),
                            content: chunk.thinking,
                            requestId: streamId,
                            kind: "thinking",
                        };
                        connectionManager.send(client.id, JSON.stringify(thinkingMsg));
                    }

                    if (chunk.content) {
                        assistantContent += chunk.content;
                        streamManager.appendToken(streamId, chunk.content);
                        const tokenMsg: TokenMessage = {
                            type: "token",
                            id: uuid(),
                            content: chunk.content,
                            requestId: streamId,
                            kind: "assistant",
                        };
                        connectionManager.send(client.id, JSON.stringify(tokenMsg));
                    }

                    if (Array.isArray(chunk.toolCalls) && chunk.toolCalls.length > 0) {
                        sawToolCalls = true;
                        toolCalls = chunk.toolCalls as OllamaToolCall[];
                    }
                }

                if (abortController.signal.aborted) {
                    streamManager.complete(streamId);
                    return;
                }

                if (sawToolCalls && toolCalls.length > 0) {
                    toolCalls = this.dedupeToolCalls(toolCalls);
                    conversationManager.addMessage(conversationId, {
                        role: "assistant",
                        content: assistantContent,
                        timestamp: Date.now(),
                        model,
                        toolCalls,
                    });

                    this.sendStatus(client.id, "tool_calling", streamId);
                    await this.executeToolCalls(client, conversationId, streamId, toolCalls, abortController.signal, approvalsAuto);
                    continue;
                }

                this.finishTurn(client, conversationId, streamId, assistantContent, model);
                return;
            }

            streamManager.complete(streamId);
            this.reWarmFastAfterDeep(model);
            this.sendError(client.id, "MAX_TOOL_TURNS", `Stopped after ${turns} tool turns.`, streamId);
        } catch (err: any) {
            if (err.name === "AbortError") {
                streamManager.complete(streamId);
                return;
            }
            Log.error("Agent stream error", err);
            if (model !== modelManager.getActive()) {
                const fallback = modelManager.getFallback();
                if (fallback) {
                    Log.info("Retrying with fallback model", { fallback, original: model });
                    return this.runAgent(client, conversationId, fallback, -1, tier, streamId, abortController);
                }
            }

            streamManager.complete(streamId);
            this.reWarmFastAfterDeep(model);
            this.sendError(client.id, "STREAM_ERROR", err.message, streamId);
        }
    }

    private async executeToolCalls(
        client: AuthenticatedClient,
        conversationId: string,
        requestId: string,
        calls: OllamaToolCall[],
        signal: AbortSignal,
        approvalsAuto: boolean,
    ): Promise<void> {
        for (const call of calls) {
            if (signal.aborted) return;

            const name = call.function?.name;
            const params = (call.function?.arguments as Record<string, unknown>) || {};
            if (!name) {
                conversationManager.addMessage(conversationId, {
                    role: "tool",
                    content: JSON.stringify({ success: false, error: "Malformed tool call: missing name" }),
                    timestamp: Date.now(),
                });
                continue;
            }

            const callId = `call_${uuid()}`;
            const spec = toolRegistry.get(name);
            const approvalRequired = spec?.requiresApproval ?? toolRegistry.requiresApproval(name);

            if (spec?.runtime === "device") {
                await this.executeDeviceTool(client, conversationId, requestId, callId, name, params, signal);
                continue;
            }

            const callMsg = {
                type: "tool_call",
                id: uuid(),
                requestId: requestId as string,
                tool: name,
                callId,
                params,
                approvalRequired,
            };
            connectionManager.send(client.id, JSON.stringify(callMsg));

            let result;
            if (approvalRequired && !approvalsAuto) {
                this.sendStatus(client.id, "tool_calling", requestId, `Waiting for approval: ${name}`);
                const decision = await approvalBroker.wait(requestId, callId, APPROVAL_TIMEOUT_MS, signal);
                if (signal.aborted) {
                    this.sendCancelledToolResult(client.id, name, requestId, callId);
                    return;
                }
                if (decision === "approve") {
                    result = await toolRegistry.execute(name, params, { clientId: client.id, requestId });
                } else {
                    result = {
                        success: false,
                        data: null,
                        error: decision === "deny" ? "The user denied this action." : "Approval request timed out.",
                        executionTimeMs: 0,
                    };
                }
            } else {
                result = await toolRegistry.execute(name, params, { clientId: client.id, requestId });
            }

            if (signal.aborted) {
                this.sendCancelledToolResult(client.id, name, requestId, callId);
                return;
            }

            const payload = toolRegistry.sendable(name, result, { requestId, callId });
            connectionManager.send(client.id, JSON.stringify(payload));

            conversationManager.addMessage(conversationId, {
                role: "tool",
                content: toolRegistry.serializeForModel(name, result),
                timestamp: Date.now(),
                tool_name: name,
            });
        }
    }

    private async executeDeviceTool(
        client: AuthenticatedClient,
        conversationId: string,
        requestId: string,
        callId: string,
        name: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
    ): Promise<void> {
        const requesterDeviceId = (client.metadata?.deviceId as string | undefined) || undefined;
        const targetParam = typeof params.device === "string" && params.device.trim() ? params.device.trim() : undefined;
        const spec = toolRegistry.get(name);
        const sendableParams = { ...params };
        delete (sendableParams as Record<string, unknown>).device;

        const recordFailure = (error: string) => {
            const result: ToolResult = { success: false, data: null, error, executionTimeMs: 0 };
            const payload = toolRegistry.sendable(name, result, { requestId, callId });
            connectionManager.send(client.id, JSON.stringify(payload));
            conversationManager.addMessage(conversationId, {
                role: "tool",
                content: toolRegistry.serializeForModel(name, result),
                timestamp: Date.now(),
                tool_name: name,
            });
        };

        const targetConnection = deviceRegistry.resolveConnection(targetParam, requesterDeviceId);
        const targetDeviceId = targetConnection ? deviceRegistry.getDeviceId(targetConnection) : undefined;
        if (!targetConnection) {
            recordFailure(
                targetParam
                    ? `No matching device '${targetParam}'. Use list_devices to see connected devices.`
                    : "No device connected for this device tool. Use list_devices to see connected devices.",
            );
            return;
        }
        if (!deviceRegistry.connectionHasCapability(targetConnection, spec?.capability)) {
            recordFailure(`Target device does not support ${name}.`);
            return;
        }

        const callMsg = {
            type: "tool_call",
            id: uuid(),
            requestId,
            tool: name,
            callId,
            params: sendableParams,
            approvalRequired: spec?.requiresApproval ?? true,
            executor: "device",
        };
        if (!connectionManager.send(targetConnection, JSON.stringify(callMsg))) {
            recordFailure("Target device disconnected.");
            return;
        }

        this.sendStatus(targetConnection, "tool_calling", requestId, `Executing ${name}`);
        const targetName = deviceRegistry.resolveName(targetConnection);
        if (targetConnection !== client.id) {
            this.sendStatus(client.id, "tool_calling", requestId, `Waiting for ${name} on ${targetName}`);
        }

        Log.info("Device tool dispatched", {
            clientId: client.id,
            deviceId: requesterDeviceId,
            targetConnection,
            tool: name,
            requestId,
            callId,
        });

        const outcome = await resultBroker.wait(requestId, callId, targetConnection, DEVICE_TOOL_TIMEOUT_MS, signal, targetDeviceId);
        if (signal.aborted) {
            recordFailure("cancelled");
            return;
        }

        const result: ToolResult = {
            success: outcome.success,
            data: outcome.data ?? null,
            error: outcome.error, 
            executionTimeMs: outcome.executionTimeMs ?? 0,
        };
        const payload = toolRegistry.sendable(name, result, { requestId, callId });
        connectionManager.send(client.id, JSON.stringify(payload));
        if (targetConnection !== client.id) {
            connectionManager.send(targetConnection, JSON.stringify(payload));
            connectionManager.send(targetConnection, JSON.stringify({
                type: "stream_end",
                id: uuid(),
                requestId,
                fullResponse: "",
                model: "",
            }));
        }

        conversationManager.addMessage(conversationId, {
            role: "tool",
            content: toolRegistry.serializeForModel(name, result),
            timestamp: Date.now(),
            tool_name: name,
        });

        Log.info("Device tool completed", {
            tool: name,
            targetConnection,
            success: result.success,
            executionTimeMs: result.executionTimeMs,
        });
    }

    private finishTurn(
        client: AuthenticatedClient,
        conversationId: string,
        streamId: string,
        assistantContent: string,
        model: string,
    ): void {
        conversationManager.addMessage(conversationId, {
            role: "assistant",
            content: assistantContent,
            timestamp: Date.now(),
            model,
        });

        const fullResponse = streamManager.getFullResponse(streamId);
        const endMsg: StreamEndMessage = {
            type: "stream_end",
            id: uuid(),
            requestId: streamId,
            fullResponse,
            model,
        };
        connectionManager.send(client.id, JSON.stringify(endMsg));
        streamManager.complete(streamId);
        this.reWarmFastAfterDeep(model);

        this.maybeSendVoice(client, streamId, fullResponse);

        Log.info("Agent turn completed", {
            clientId: client.id,
            requestId: streamId,
            model,
            responseLength: fullResponse.length,
        });
    }

    private async generateResponse(client: AuthenticatedClient, conversationId: string, requestId: string, model: string, keepAlive: number): Promise<void> {
        const conversation = conversationManager.get(conversationId);
        if (!conversation) {
            this.sendError(client.id, "CONVERSATION_NOT_FOUND", "Conversation not found", requestId);
            return;
        }

        await this.ensureCompacted(conversation, model, new AbortController().signal);

        const latest = conversationManager.getLatestUserMessage(conversationId);
        const recall = latest ? await this.recallMemories(latest) : "";

        const messages = promptBuilder.buildChatMessages(
            conversation.messages.map(m => ({
                role: m.role,
                content: m.content,
                ...(Array.isArray(m.toolCalls) && m.toolCalls.length > 0 ? { toolCalls: m.toolCalls } : {}),
                ...(m.role === "tool" && m.tool_name ? { tool_name: m.tool_name } : {}),
            })),
            recall ? `${conversation.systemPrompt}\n\n${recall}` : conversation.systemPrompt,
        );

        this.sendStatus(client.id, "generating", requestId);

        try {
            const response = await ollamaClient.chat({ model, messages, stream: false, keepAlive });

            conversationManager.addMessage(conversationId, {
                role: "assistant",
                content: response,
                timestamp: Date.now(),
                model,
            });
            this.reWarmFastAfterDeep(model);

            const endMsg: StreamEndMessage = {
                type: "stream_end",
                id: uuid(),
                requestId,
                fullResponse: response,
                model,
            };
            connectionManager.send(client.id, JSON.stringify(endMsg));

            this.maybeSendVoice(client, requestId, response);

            Log.info("Chat response completed (non-streaming)", {
                clientId: client.id,
                requestId,
                model,
                responseLength: response.length,
            });
        } catch (err: any) {
            Log.error("Generate error", err);
            this.sendError(client.id, "GENERATE_ERROR", err.message, requestId);
        }
    }

    private async ensureCompacted(conversation: { id: string; systemPrompt: string }, model: string, signal: AbortSignal): Promise<void> {
        const id = conversation.id;
        if (conversationManager.isCompacting(id)) return;

        if (!conversationManager.shouldCompact(id, conversationManager.estimateTokens(id), modelManager.getMaxContext(model))) {
            return;
        }

        conversationManager.setCompacting(id, true);
        try {
            const plan = conversationManager.prepareCompact(id);
            if (plan.toSummarize.length === 0) return;

            const summary = await this.summarizeMessages(plan.toSummarize, signal);
            if (!summary) return;

            conversationManager.applyCompaction(id, summary, plan.keepTail);
            Log.info("Compaction applied", { conversationId: id });
        } catch (err: any) {
            if (err?.name === "AbortError") return;
            Log.error("Compaction failed", err);
        } finally {
            conversationManager.setCompacting(id, false);
        }
    }

    private async summarizeMessages(messages: ConversationMessage[], signal: AbortSignal): Promise<string | null> {
        const prompt = promptBuilder.buildSummaryPrompt(messages);
        try {
            return await ollamaClient.chat({
                model: modelManager.getDeep(),
                messages: [
                    {
                        role: "system",
                        content: "You are a summarization assistant. Write a concise but complete factual summary of the conversation that preserves every important detail, decision, fact, and the current state of any tasks, so the assistant can continue seamlessly.",
                    },
                    { role: "user", content: prompt },
                ],
                stream: false,
                keepAlive: 0,
                signal,
            });
        } catch (err: any) {
            Log.error("Summarize failed", err);
            return null;
        }
    }

    private async recallMemories(query: string): Promise<string> {
        try {
            if (process.env.JARVIS_MEMORY_AUTOLOAD === "0") return "";
            const topK = parseInt(process.env.JARVIS_MEMORY_TOP_K || "3", 10);
            const minScore = parseFloat(process.env.JARVIS_MEMORY_MIN_SCORE || "0.4");
            const results = await searchMemory(query, topK, minScore);
            if (!results.length) return "";
            const facts = results.map(r => `- ${r.content}`).join("\n");
            Log.info("Memory recall injected", { query, matches: results.length });
            return `[Relevant memories]\n${facts}\n\nOnly rely on these if relevant to the current request.`;
        } catch (err: any) {
            Log.error("Memory recall failed", err);
            return "";
        }
    }

    private dedupeToolCalls(calls: OllamaToolCall[]): OllamaToolCall[] {
        const seen = new Set<string>();
        const out: OllamaToolCall[] = [];
        for (const call of calls) {
            const name = call.function?.name || "";
            let args = "";
            if (call.function && call.function.arguments) {
                try {
                    args = JSON.stringify(call.function.arguments);
                } catch {
                    args = "";
                }
            }
            const key = `${name}:${args}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(call);
        }
        return out;
    }

    private reWarmFastAfterDeep(model: string): void {
        if (model !== modelManager.getDeep()) return;
        const fast = modelManager.getActive();
        setTimeout(() => {
            ollamaClient.warmup(fast).catch(() => {});
        }, 250);
    }

    private maybeSendVoice(client: AuthenticatedClient, requestId: string, text: string): void {
        if (!this.voiceRequests.delete(requestId)) return;
        if (!ttsService.ready || !text?.trim()) return;
        void ttsService
            .synthesize(text)
            .then((synth) => {
                if (!synth) return;
                connectionManager.send(client.id, JSON.stringify({
                    type: "voice",
                    id: uuid(),
                    requestId,
                    audio: synth.audio.toString("base64"),
                    format: synth.format,
                    sampleRate: synth.sampleRate,
                }));
            })
            .catch((err) => Log.warn("TTS synthesis failed", { error: err.message }));
    }

    cancelStream(requestId: string): boolean {
        approvalBroker.abortRequest(requestId);
        resultBroker.abortRequest(requestId);
        this.voiceRequests.delete(requestId);
        return streamManager.cancel(requestId);
    }

    private sendBridgeMessage(clientId: string, streamId: string): void {
        const bridge = ["Let me think about it", ", sir."];
        for (const part of bridge) {
            const bridgeMsg: TokenMessage = {
                type: "token",
                id: uuid(),
                content: part,
                requestId: streamId,
                kind: "assistant",
            };
            connectionManager.send(clientId, JSON.stringify(bridgeMsg));
        }
    }

    private sendCancelledToolResult(clientId: string, name: string, requestId: string, callId: string): void {
        const result: ToolResult = { success: false, data: null, error: "cancelled", executionTimeMs: 0 };
        const payload = toolRegistry.sendable(name, result, { requestId, callId });
        connectionManager.send(clientId, JSON.stringify(payload));
    }

    private sendStatus(clientId: string, status: StatusMessage["status"], requestId?: string, detail?: string): void {
        const msg: StatusMessage = {
            type: "status",
            id: uuid(),
            status,
            requestId,
            detail,
        };
        connectionManager.send(clientId, JSON.stringify(msg));
    }

    private sendError(clientId: string, code: string, message: string, requestId?: string): void {
        connectionManager.send(clientId, JSON.stringify({
            type: "error",
            id: uuid(),
            code,
            message,
            requestId,
        }));
    }
}

const aiOrchestrator = new AIOrchestrator();
export default aiOrchestrator;
