import { v4 as uuid } from "uuid";
import type { Conversation, ConversationMessage } from "../types/ai";
import { estimateMessageTokens, estimateTokens } from "../utils/tokens";
import Log from "../Log";

interface CompactPlan {
    toSummarize: ConversationMessage[];
    keepTail: ConversationMessage[];
}

class ConversationManager {
    private conversations = new Map<string, Conversation>();
    private sessionIndex = new Map<string, Set<string>>();
    private compacting = new Set<string>();
    private compactedAt = new Map<string, number>();
    private readonly MAX_MESSAGES = 80;
    private readonly MAX_CONVERSATIONS = 1000;
    private readonly CLEANUP_INTERVAL = 300000;
    private readonly COMPACT_TAIL = 12;
    private cleanupTimer: NodeJS.Timeout | null = null;

    start(): void {
        this.cleanupTimer = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
        Log.info("ConversationManager started");
    }

    create(clientId: string, sessionId: string, systemPrompt: string, model: string): Conversation {
        const id = uuid();
        const conversation: Conversation = {
            id,
            sessionId,
            clientId,
            messages: [],
            systemPrompt,
            model,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        if (systemPrompt) {
            conversation.messages.push({
                role: "system",
                content: systemPrompt,
                timestamp: Date.now(),
            });
        }

        this.conversations.set(id, conversation);

        if (!this.sessionIndex.has(sessionId)) {
            this.sessionIndex.set(sessionId, new Set());
        }
        this.sessionIndex.get(sessionId)!.add(id);

        this.enforceLimits();
        return conversation;
    }

    getBySession(sessionId: string, clientId?: string): Conversation | undefined {
        const ids = this.sessionIndex.get(sessionId);
        if (!ids || ids.size === 0) return undefined;
        const matchingIds = Array.from(ids).reverse();
        for (const id of matchingIds) {
            const conversation = this.conversations.get(id);
            if (conversation && (!clientId || conversation.clientId === clientId)) return conversation;
        }
        return undefined;
    }

    get(conversationId: string): Conversation | undefined {
        return this.conversations.get(conversationId);
    }

    addMessage(conversationId: string, message: ConversationMessage): void {
        const conv = this.conversations.get(conversationId);
        if (!conv) return;

        conv.messages.push(message);
        conv.updatedAt = Date.now();

        if (conv.messages.length > this.MAX_MESSAGES) {
            const systemMsg = conv.messages[0];
            conv.messages = [systemMsg, ...conv.messages.slice(-this.MAX_MESSAGES + 1)];
        }
    }

    getMessages(conversationId: string): ConversationMessage[] {
        return this.conversations.get(conversationId)?.messages || [];
    }

    getOrCreate(clientId: string, sessionId: string | undefined, systemPrompt: string, model: string): Conversation {
        const sid = sessionId || `default-${clientId}`;
        const existing = this.getBySession(sid, clientId);
        if (existing) {
            if (existing.model !== model) existing.model = model;
            return existing;
        }
        return this.create(clientId, sid, systemPrompt, model);
    }

    delete(conversationId: string): boolean {
        const conv = this.conversations.get(conversationId);
        if (!conv) return false;

        this.conversations.delete(conversationId);
        const session = this.sessionIndex.get(conv.sessionId);
        if (session) {
            session.delete(conversationId);
            if (session.size === 0) this.sessionIndex.delete(conv.sessionId);
        }
        return true;
    }

    getClientConversations(clientId: string): Conversation[] {
        return Array.from(this.conversations.values())
            .filter(c => c.clientId === clientId)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    private enforceLimits(): void {
        if (this.conversations.size <= this.MAX_CONVERSATIONS) return;
        const sorted = Array.from(this.conversations.values())
            .sort((a, b) => a.updatedAt - b.updatedAt);
        const toRemove = sorted.slice(0, this.conversations.size - this.MAX_CONVERSATIONS);
        for (const conv of toRemove) {
            this.delete(conv.id);
        }
    }

    private cleanup(): void {
        const now = Date.now();
        const oneHour = 3600000;
        for (const [id, conv] of this.conversations) {
            if (now - conv.updatedAt > oneHour && conv.messages.length <= 2) {
                this.delete(id);
            }
        }
    }

    stop(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    getStats(): { totalConversations: number; activeSessions: number } {
        return {
            totalConversations: this.conversations.size,
            activeSessions: this.sessionIndex.size,
        };
    }

    estimateTokens(conversationId: string): number {
        const conv = this.conversations.get(conversationId);
        if (!conv) return 0;
        let total = 0;
        for (const msg of conv.messages) {
            total += estimateMessageTokens(msg.role, msg.content);
            if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
                total += estimateTokens(JSON.stringify(msg.toolCalls));
            }
            if (Array.isArray(msg.toolResults) && msg.toolResults.length > 0) {
                total += estimateTokens(JSON.stringify(msg.toolResults));
            }
        }
        return total;
    }

    isCompacting(conversationId: string): boolean {
        return this.compacting.has(conversationId);
    }

    setCompacting(conversationId: string, value: boolean): void {
        if (value) this.compacting.add(conversationId);
        else this.compacting.delete(conversationId);
    }

    shouldCompact(conversationId: string, estimatedTokens: number, maxContext: number): boolean {
        const conv = this.conversations.get(conversationId);
        if (!conv) return false;
        const nonSystem = conv.messages.length - 1;
        if (nonSystem <= this.COMPACT_TAIL + 4) return false;

        const threshold = parseFloat(process.env.JARVIS_COMPACT_THRESHOLD || "0.55");
        const safe = maxContext * threshold;
        if (estimatedTokens < safe) return false;

        const batch = parseInt(process.env.JARVIS_COMPACT_BATCH || "10", 10);
        const lastAt = this.compactedAt.get(conversationId);
        const urgent = estimatedTokens > maxContext * 0.85;
        if (lastAt !== undefined && conv.messages.length < lastAt + batch && !urgent) return false;
        return true;
    }

    prepareCompact(conversationId: string): CompactPlan {
        const conv = this.conversations.get(conversationId);
        if (!conv) return { toSummarize: [], keepTail: [] };

        const messages = conv.messages;
        const nonSystem = messages[0]?.role === "system" ? messages.slice(1) : messages;
        if (nonSystem.length <= this.COMPACT_TAIL) {
            return { toSummarize: [], keepTail: nonSystem };
        }

        const summarizeCount = nonSystem.length - this.COMPACT_TAIL;
        const toSummarize = nonSystem.slice(0, summarizeCount);
        let keepTail = nonSystem.slice(summarizeCount);

        while (keepTail.length > 0 && keepTail[0].role === "tool") {
            keepTail = keepTail.slice(1);
        }

        return { toSummarize, keepTail };
    }

    applyCompaction(conversationId: string, summaryContent: string, keepTail: ConversationMessage[]): void {
        const conv = this.conversations.get(conversationId);
        if (!conv) return;
        const previousLength = conv.messages.length;

        const summaryMessage: ConversationMessage = {
            role: "assistant",
            content: `[Conversation summary so far]\n${summaryContent.trim()}`,
            timestamp: Date.now(),
            model: conv.model,
        };

        const messages = conv.messages[0]?.role === "system" ? [conv.messages[0]] : [];
        conv.messages = [...messages, summaryMessage, ...keepTail];
        conv.updatedAt = Date.now();
        this.compactedAt.set(conversationId, conv.messages.length);

        Log.info("Conversation compacted", {
            conversationId,
            previousMessages: previousLength,
            keptMessages: conv.messages.length,
        });
    }

    getLatestUserMessage(conversationId: string): string | null {
        const conv = this.conversations.get(conversationId);
        if (!conv) return null;
        for (let i = conv.messages.length - 1; i >= 0; i--) {
            if (conv.messages[i].role === "user") return conv.messages[i].content;
        }
        return null;
    }
}

const conversationManager = new ConversationManager();
export default conversationManager;
