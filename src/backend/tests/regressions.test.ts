import assert from "node:assert/strict";
import test from "node:test";
import conversationManager from "../ai/ConversationManager";
import toolRegistry from "../tools/registry";
import { addTask, listTasks } from "../agent/Scheduler/taskStore";
import llmClient, { finalizeToolCalls } from "../ai/LLMClient";
import streamManager, { isStreamTimeout } from "../server/ws/StreamManager";
import { closeBrowser, listPageIds, openPage } from "../agent/Browser/browserSession";

test("compaction keeps the summary before the retained tail", () => {
    const conversation = conversationManager.create("client", crypto.randomUUID(), "system", "model");
    for (let i = 0; i < 20; i++) {
        conversationManager.addMessage(conversation.id, {
            role: "user",
            content: `message ${i}`,
            timestamp: Date.now(),
        });
    }

    const plan = conversationManager.prepareCompact(conversation.id);
    assert.ok(plan.toSummarize.length > 0);
    assert.ok(plan.keepTail.length > 0);

    conversationManager.applyCompaction(conversation.id, "summary", plan.keepTail);
    const messages = conversationManager.getMessages(conversation.id);

    assert.equal(messages[0].role, "system");
    assert.equal(messages[1].role, "assistant");
    assert.match(messages[1].content, /^\[Conversation summary so far\]/);
    assert.equal(messages[messages.length - 1].content, "message 19");

    conversationManager.delete(conversation.id);
});

test("compaction rate limit counts messages since the last compaction", () => {
    const conversation = conversationManager.create("client", crypto.randomUUID(), "system", "model");
    for (let i = 0; i < 20; i++) {
        conversationManager.addMessage(conversation.id, {
            role: "user",
            content: `message ${i}`,
            timestamp: Date.now(),
        });
    }

    const plan = conversationManager.prepareCompact(conversation.id);
    conversationManager.applyCompaction(conversation.id, "summary", plan.keepTail);

    for (let i = 0; i < 4; i++) {
        conversationManager.addMessage(conversation.id, {
            role: "user",
            content: `follow-up ${i}`,
            timestamp: Date.now(),
        });
    }
    assert.equal(conversationManager.shouldCompact(conversation.id, 60, 100), false);

    for (let i = 0; i < 6; i++) {
        conversationManager.addMessage(conversation.id, {
            role: "user",
            content: `follow-up ${i + 4}`,
            timestamp: Date.now(),
        });
    }
    assert.equal(conversationManager.shouldCompact(conversation.id, 60, 100), true);

    conversationManager.delete(conversation.id);
});

test("unknown allowlisted tools are ignored instead of crashing", () => {
    const previous = process.env.JARVIS_TOOLS;
    process.env.JARVIS_TOOLS = "definitely_not_a_tool";
    try {
        assert.deepEqual(toolRegistry.defsForOllama(), []);
    } finally {
        if (previous === undefined) delete process.env.JARVIS_TOOLS;
        else process.env.JARVIS_TOOLS = previous;
    }
});

test("browser_open with a rejected URL does not leak a tracked page (dev M2)", async () => {
    const previous = process.env.JARVIS_FETCH_ALLOW_PRIVATE;
    delete process.env.JARVIS_FETCH_ALLOW_PRIVATE;
    try {
        for (let i = 0; i < 6; i++) {
            await assert.rejects(openPage("http://127.0.0.1:9/"));
        }
        assert.equal(listPageIds().length, 0);
    } finally {
        if (previous !== undefined) process.env.JARVIS_FETCH_ALLOW_PRIVATE = previous;
        await closeBrowser();
    }
});

test("stale-stream sweep is idle-based and aborts with a timeout reason (dev H1)", () => {
    const previous = process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS;
    process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS = "1000";
    try {
        const busy = new AbortController();
        const idle = new AbortController();
        const busyId = streamManager.create("client", "session", "model", busy);
        const idleId = streamManager.create("client", "session", "model", idle);
        // Both started long ago; only one kept making progress.
        streamManager.get(busyId)!.startedAt = Date.now() - 600_000;
        streamManager.get(idleId)!.startedAt = Date.now() - 600_000;
        streamManager.get(idleId)!.lastActivityAt = Date.now() - 5_000;
        streamManager.touch(busyId);

        assert.equal(streamManager.cleanupStale(), 1);
        assert.equal(busy.signal.aborted, false);
        assert.equal(isStreamTimeout(idle.signal), true);
        streamManager.complete(busyId);
    } finally {
        if (previous === undefined) delete process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS;
        else process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS = previous;
    }
});

test("cancelling a chat stream closes the upstream LLM connection (dev H2)", async () => {
    const http = await import("node:http");
    let closed = 0;
    const server = http.createServer((req, res) => {
        req.resume();
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const timer = setInterval(() => {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}\n\n`);
        }, 20);
        res.on("close", () => { clearInterval(timer); closed++; });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client = llmClient as any;
    const previousBase = client.baseUrl;
    client.baseUrl = `http://127.0.0.1:${port}/v1`;
    const waitFor = async (n: number) => {
        for (let i = 0; i < 100 && closed < n; i++) await new Promise(r => setTimeout(r, 20));
    };
    try {
        // Consumer stops early (as runAgent does with `break`).
        for await (const chunk of llmClient.chatStream({ model: "m", messages: [], stream: true })) {
            assert.equal(chunk.content, "x");
            break;
        }
        await waitFor(1);
        assert.equal(closed, 1, "upstream stream should close when the consumer breaks");

        // Caller aborts mid-stream (user cancel / sweeper).
        const abort = new AbortController();
        let seen = 0;
        try {
            for await (const _ of llmClient.chatStream({ model: "m", messages: [], stream: true, signal: abort.signal })) {
                if (++seen === 2) abort.abort();
            }
        } catch {
            // An AbortError or a clean end are both acceptable here.
        }
        await waitFor(2);
        assert.equal(closed, 2, "upstream stream should close when the request is aborted");
    } finally {
        client.baseUrl = previousBase;
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});

test("messages added while compacting are kept (dev H3)", () => {
    const conversation = conversationManager.create("client", crypto.randomUUID(), "system", "model");
    for (let i = 0; i < 20; i++) {
        conversationManager.addMessage(conversation.id, { role: "user", content: `message ${i}`, timestamp: Date.now() });
    }
    const plan = conversationManager.prepareCompact(conversation.id);
    // A concurrent request appends while the summary is being generated.
    conversationManager.addMessage(conversation.id, { role: "user", content: "late question", timestamp: Date.now() });
    conversationManager.addMessage(conversation.id, { role: "assistant", content: "late answer", timestamp: Date.now() });
    conversationManager.applyCompaction(conversation.id, "summary", plan.keepTail, plan.snapshotLast);

    const contents = conversationManager.getMessages(conversation.id).map(m => m.content);
    assert.deepEqual(contents.slice(-3), ["message 19", "late question", "late answer"]);
    conversationManager.delete(conversation.id);
});

test("a corrupt JSON store is backed up instead of being overwritten (dev H4)", async () => {
    const { mkdtemp, writeFile, readFile, readdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "jarvis-store-"));
    const previous = process.env.JARVIS_DATA_DIR;
    process.env.JARVIS_DATA_DIR = dir;
    try {
        const truncated = '{"tasks": [{"id": "a", "instructions": "precious"';
        await writeFile(join(dir, "tasks.json"), truncated);
        addTask("new task", Date.now() + 60_000);

        const files = await readdir(dir);
        const backup = files.find(f => f.startsWith("tasks.json.corrupt-"));
        assert.ok(backup, `expected a backup, got ${files.join(", ")}`);
        assert.equal(await readFile(join(dir, backup!), "utf-8"), truncated);
        assert.equal(listTasks().length, 1);
        assert.equal(files.some(f => f.endsWith(".tmp")), false);

        // Valid JSON with the wrong shape must not crash with a TypeError.
        await writeFile(join(dir, "tasks.json"), "{}");
        assert.doesNotThrow(() => addTask("another", Date.now() + 60_000));
    } finally {
        if (previous === undefined) delete process.env.JARVIS_DATA_DIR;
        else process.env.JARVIS_DATA_DIR = previous;
        await rm(dir, { recursive: true, force: true });
    }
});

test("tool calls without backend ids get unique ids (dev L13)", () => {
    const pending = new Map([[0, { name: "a", args: "{}" }], [1, { name: "b", args: "" }]]);
    const first = finalizeToolCalls(pending as any);
    const second = finalizeToolCalls(pending as any);
    assert.notEqual(first[0].id, second[0].id);
    assert.notEqual(first[0].id, first[1].id);
    assert.match(first[0].id!, /^call_/);
});
