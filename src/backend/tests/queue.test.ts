import assert from "node:assert/strict";
import test from "node:test";
import { ConversationQueue } from "../ai/ConversationQueue";
import aiOrchestrator from "../ai";
import modelRouter from "../ai/ModelRouter";
import llmClient from "../ai/LLMClient";
import connectionManager from "../server/ws/ConnectionManager";

function deferred() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

test("conversation queue runs turns one at a time in arrival order (dev M10)", async () => {
    const queue = new ConversationQueue(() => 2);
    const order: string[] = [];
    const gates = [deferred(), deferred(), deferred()];
    const make = (name: string, gate: { promise: Promise<void> }) => async () => {
        order.push(`start:${name}`);
        await gate.promise;
        order.push(`end:${name}`);
    };

    const a = queue.enqueue("conv", "a", "c1", make("a", gates[0]));
    const b = queue.enqueue("conv", "b", "c1", make("b", gates[1]));
    const c = queue.enqueue("conv", "c", "c1", make("c", gates[2]));
    const d = queue.enqueue("conv", "d", "c1", async () => { order.push("d"); });
    const other = queue.enqueue("other", "x", "c1", async () => { order.push("x"); });

    assert.equal(a.status, "started");
    assert.equal(b.status, "queued");
    assert.equal(c.status, "queued");
    assert.deepEqual(d, { status: "full", limit: 2 });
    assert.equal(other.status, "started", "other conversations are not blocked");
    if (b.status !== "queued" || c.status !== "queued") throw new Error("unreachable");
    assert.equal(b.ahead, 1);
    assert.equal(c.ahead, 2);

    await new Promise(r => setImmediate(r));
    assert.deepEqual(order, ["start:a", "x"]);
    gates[0].release();
    gates[1].release();
    gates[2].release();
    await Promise.all([a.status === "started" && a.done, b.done, c.done]);
    assert.deepEqual(order, ["start:a", "x", "end:a", "start:b", "end:b", "start:c", "end:c"]);
    assert.equal(queue.waitingCount("conv"), 0);
    assert.equal(queue.has("a"), false, "lane is cleaned up once drained");
});

test("cancelling a queued turn removes it without running it; owner is checked (dev M10)", async () => {
    const queue = new ConversationQueue(() => 5);
    const gate = deferred();
    let ranB = false;
    let ranC = false;
    const a = queue.enqueue("conv", "a", "c1", () => gate.promise);
    const b = queue.enqueue("conv", "b", "c1", async () => { ranB = true; });
    const c = queue.enqueue("conv", "c", "c1", async () => { ranC = true; });

    assert.equal(queue.cancel("b", "intruder"), "forbidden");
    assert.equal(queue.cancel("b", "c1"), "removed");
    assert.equal(queue.cancel("b", "c1"), "not_queued");
    assert.equal(queue.cancel("a", "c1"), "not_queued", "the running turn is cancelled via the stream, not the queue");
    await (b.status !== "full" ? b.done : undefined);
    gate.release();
    await (a.status === "started" && a.done);
    await (c.status === "queued" && c.done);
    assert.equal(ranB, false);
    assert.equal(ranC, true);
});

test("JARVIS_CHAT_QUEUE_MAX=0 rejects a second message on a busy conversation", () => {
    const previous = process.env.JARVIS_CHAT_QUEUE_MAX;
    process.env.JARVIS_CHAT_QUEUE_MAX = "0";
    try {
        const queue = new ConversationQueue();
        queue.enqueue("conv", "a", "c1", () => new Promise(() => {}));
        assert.equal(queue.enqueue("conv", "b", "c1", async () => {}).status, "full");
    } finally {
        if (previous === undefined) delete process.env.JARVIS_CHAT_QUEUE_MAX;
        else process.env.JARVIS_CHAT_QUEUE_MAX = previous;
    }
});

test("concurrent chats on one conversation are serialized end-to-end; queue-full and queued cancel notify the client (dev M10)", async () => {
    const router = modelRouter as any;
    const llm = llmClient as any;
    const cm = connectionManager as any;
    const originalRoute = router.route;
    const originalStream = llm.chatStream;
    const originalSend = cm.send;
    const originalGet = cm.get;
    const previousMax = process.env.JARVIS_CHAT_QUEUE_MAX;
    const previousAutoload = process.env.JARVIS_MEMORY_AUTOLOAD;
    process.env.JARVIS_CHAT_QUEUE_MAX = "2";
    process.env.JARVIS_MEMORY_AUTOLOAD = "0";

    const client = { id: crypto.randomUUID(), apiKeyId: "none", metadata: {} } as any;
    const sent: any[] = [];
    const active = { count: 0, max: 0 };
    const seen: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred>>();

    router.route = async () => ({ model: "m", tier: "fast" });
    llm.chatStream = async function* (req: any) {
        const last = [...req.messages].reverse().find((m: any) => m.role === "user");
        const content = String(last?.content ?? "");
        seen.push(content);
        active.count++;
        active.max = Math.max(active.max, active.count);
        try {
            await gates.get(content)!.promise;
            yield { content: `reply to ${content}` };
        } finally {
            active.count--;
        }
    };
    cm.send = (id: string, raw: string) => { if (id === client.id) sent.push(JSON.parse(raw)); return true; };
    cm.get = (id: string) => (id === client.id ? client : originalGet.call(cm, id));

    try {
        const sessionId = crypto.randomUUID();
        const ids = ["one", "two", "three", "four"].map(() => crypto.randomUUID());
        for (const name of ["one", "two", "three"]) gates.set(name, deferred());
        const p1 = aiOrchestrator.handleChat(client, { id: ids[0], content: "one", sessionId });
        const p2 = aiOrchestrator.handleChat(client, { id: ids[1], content: "two", sessionId });
        const p3 = aiOrchestrator.handleChat(client, { id: ids[2], content: "three", sessionId });
        await aiOrchestrator.handleChat(client, { id: ids[3], content: "four", sessionId });

        const busy = sent.find(m => m.type === "error" && m.requestId === ids[3]);
        assert.equal(busy?.code, "CONVERSATION_BUSY");
        assert.ok(sent.some(m => m.type === "status" && m.requestId === ids[1] && /Queued/.test(m.detail)));

        // Cancel the third (queued) message; the cancel is owner-checked.
        assert.equal(aiOrchestrator.cancelQueued(ids[2], "someone-else"), true);
        assert.equal(aiOrchestrator.cancelQueued(ids[2], client.id), true);
        await p3;
        assert.ok(sent.some(m => m.type === "status" && m.requestId === ids[2] && m.status === "idle"));

        await new Promise(r => setTimeout(r, 20));
        assert.deepEqual(seen, ["one"], "second turn must not start while the first is running");
        gates.get("one")!.release();
        await p1;
        await new Promise(r => setTimeout(r, 20));
        assert.deepEqual(seen, ["one", "two"]);
        gates.get("two")!.release();
        await p2;

        assert.equal(active.max, 1, "never more than one turn at a time on the conversation");
        const ends = sent.filter(m => m.type === "stream_end").map(m => m.requestId);
        assert.deepEqual(ends, [ids[0], ids[1]], "replies complete in arrival order, cancelled one never runs");
    } finally {
        router.route = originalRoute;
        llm.chatStream = originalStream;
        cm.send = originalSend;
        cm.get = originalGet;
        if (previousMax === undefined) delete process.env.JARVIS_CHAT_QUEUE_MAX;
        else process.env.JARVIS_CHAT_QUEUE_MAX = previousMax;
        if (previousAutoload === undefined) delete process.env.JARVIS_MEMORY_AUTOLOAD;
        else process.env.JARVIS_MEMORY_AUTOLOAD = previousAutoload;
    }
});
