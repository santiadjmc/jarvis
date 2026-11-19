import assert from "node:assert/strict";
import test from "node:test";
import conversationManager from "../ai/ConversationManager";
import toolRegistry from "../tools/registry";
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
