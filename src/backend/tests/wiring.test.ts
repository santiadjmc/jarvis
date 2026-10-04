import assert from "node:assert/strict";
import test from "node:test";
import conversationManager from "../ai/ConversationManager";
import streamManager from "../server/ws/StreamManager";
import deviceRegistry from "../server/ws/DeviceRegistry";
import { streamDelta } from "../ai/OllamaClient";

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
