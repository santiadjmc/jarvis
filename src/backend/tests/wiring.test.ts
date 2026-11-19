import assert from "node:assert/strict";
import test from "node:test";
import conversationManager from "../ai/ConversationManager";
import streamManager from "../server/ws/StreamManager";
import deviceRegistry from "../server/ws/DeviceRegistry";
import { streamDelta } from "../ai/LLMClient";

test("streams retain the client request id and reject duplicate active ids", () => {
    const requestId = crypto.randomUUID();
    const abort = new AbortController();
    assert.equal(streamManager.create("client-a", "session-a", "model", abort, requestId), requestId);
    assert.throws(() => streamManager.create("client-a", "session-a", "model", new AbortController(), requestId));
    assert.equal(streamManager.cancel(requestId), true);
});

test("same session ids remain isolated between clients", () => {
    const sessionId = crypto.randomUUID();
    const first = conversationManager.getOrCreate("client-a", sessionId, "system", "model-a");
    const second = conversationManager.getOrCreate("client-b", sessionId, "system", "model-b");

    assert.notEqual(first.id, second.id);
    assert.equal(conversationManager.getOrCreate("client-a", sessionId, "system", "model-a").id, first.id);
    assert.equal(conversationManager.getOrCreate("client-b", sessionId, "system", "model-b").id, second.id);

    conversationManager.delete(first.id);
    conversationManager.delete(second.id);
});

test("device capabilities are tracked per connection", () => {
    const connectionId = crypto.randomUUID();
    deviceRegistry.upsert(connectionId, {
        deviceId: crypto.randomUUID(),
        deviceName: "Test device",
        deviceType: "test",
        capabilities: ["device:time"],
    });

    assert.equal(deviceRegistry.connectionHasCapability(connectionId, "device:time"), true);
    assert.equal(deviceRegistry.connectionHasCapability(connectionId, "device:open_url"), false);
    deviceRegistry.onClientDisconnect(connectionId);
});

test("cumulative model chunks become stream deltas", () => {
    assert.equal(streamDelta("The", ""), "The");
    assert.equal(streamDelta("The quick", "The"), " quick");
    assert.equal(streamDelta("The quick", "The quick"), "");
    assert.equal(streamDelta(" brown", "The quick"), " brown");
});

test("an uncaught exception exits non-zero so ProcessManager restarts; rejections are only logged", async () => {
    const { execFile } = await import("node:child_process");
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "jarvis-crash-"));
    const handlers = resolve(__dirname, "../utils/crashHandlers.ts");
    const run = (body: string) => new Promise<{ code: number | null; stdout: string }>((done) => {
        const file = join(dir, `${crypto.randomUUID()}.ts`);
        writeFile(file, `import { installCrashHandlers } from ${JSON.stringify(handlers)};\ninstallCrashHandlers();\n${body}\n`).then(() => {
            execFile(process.execPath, ["--import", "tsx", file], { cwd: resolve(__dirname, "../../.."), timeout: 20000 }, (err, stdout) => {
                done({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout });
            });
        });
    });
    try {
        const crashed = await run(`setTimeout(() => { throw new Error("boom"); }, 0);\nsetTimeout(() => console.log("still alive"), 5000);`);
        assert.equal(crashed.code, 1);
        assert.doesNotMatch(crashed.stdout, /still alive/);

        const rejected = await run(`Promise.reject(new Error("nope"));\nsetTimeout(() => console.log("still alive"), 300);`);
        assert.equal(rejected.code, 0);
        assert.match(rejected.stdout, /still alive/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
