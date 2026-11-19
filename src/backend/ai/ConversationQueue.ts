/**
 * Serializes chat turns per conversation (dev M10). Turns on one conversation
 * run one at a time in arrival order; turns on different conversations still
 * run in parallel. A turn waiting in the queue can be cancelled, which removes
 * it without ever running it.
 */

export type EnqueueOutcome =
    | { status: "started"; done: Promise<void> }
    | { status: "queued"; ahead: number; done: Promise<void> }
    | { status: "full"; limit: number };

interface Waiting {
    requestId: string;
    clientId: string;
    task: () => Promise<void>;
    resolve: () => void;
    reject: (err: unknown) => void;
}

interface Lane {
    active: string;
    waiting: Waiting[];
}

export function maxQueuedPerConversation(): number {
    const raw = process.env.JARVIS_CHAT_QUEUE_MAX;
    if (raw === undefined || raw.trim() === "") return 5;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
}

export class ConversationQueue {
    private lanes = new Map<string, Lane>();

    constructor(private readonly limit: () => number = maxQueuedPerConversation) {}

    /** True if the request is running or waiting in any lane. */
    has(requestId: string): boolean {
        for (const lane of this.lanes.values()) {
            if (lane.active === requestId || lane.waiting.some(w => w.requestId === requestId)) return true;
        }
        return false;
    }

    enqueue(key: string, requestId: string, clientId: string, task: () => Promise<void>): EnqueueOutcome {
        const lane = this.lanes.get(key);
        if (!lane) {
            const fresh: Lane = { active: requestId, waiting: [] };
            this.lanes.set(key, fresh);
            return { status: "started", done: this.execute(key, fresh, task) };
        }
        const limit = this.limit();
        if (lane.waiting.length >= limit) return { status: "full", limit };
        const ahead = lane.waiting.length + 1;
        const done = new Promise<void>((resolve, reject) => {
            lane.waiting.push({ requestId, clientId, task, resolve, reject });
        });
        return { status: "queued", ahead, done };
    }

    /**
     * Removes a waiting (not yet started) request. Returns "removed", "forbidden"
     * if it belongs to another client, or "not_queued".
     */
    cancel(requestId: string, clientId?: string): "removed" | "forbidden" | "not_queued" {
        for (const lane of this.lanes.values()) {
            const index = lane.waiting.findIndex(w => w.requestId === requestId);
            if (index === -1) continue;
            const entry = lane.waiting[index];
            if (clientId !== undefined && entry.clientId !== clientId) return "forbidden";
            lane.waiting.splice(index, 1);
            entry.resolve();
            return "removed";
        }
        return "not_queued";
    }

    /** Number of turns waiting behind the active one for this conversation. */
    waitingCount(key: string): number {
        return this.lanes.get(key)?.waiting.length ?? 0;
    }

    private async execute(key: string, lane: Lane, task: () => Promise<void>): Promise<void> {
        try {
            await task();
        } finally {
            this.next(key, lane);
        }
    }

    private next(key: string, lane: Lane): void {
        const entry = lane.waiting.shift();
        if (!entry) {
            this.lanes.delete(key);
            return;
        }
        lane.active = entry.requestId;
        this.execute(key, lane, entry.task).then(entry.resolve, entry.reject);
    }
}
