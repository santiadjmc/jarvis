import assert from "node:assert/strict";
import test from "node:test";
import resultBroker from "../tools/ResultBroker";
import approvalBroker from "../tools/ApprovalBroker";

const ok = (data: string) => ({ success: true, data });

test("duplicate device tool results are ignored after the first one", async () => {
    const requestId = crypto.randomUUID();
    const conn = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const pending = resultBroker.wait(requestId, "call_dup", conn, 5000, undefined, deviceId, "key-a");

    assert.equal(resultBroker.resolve(conn, requestId, "call_dup", ok("first"), deviceId, "key-a"), "accepted");
    assert.equal(resultBroker.resolve(conn, requestId, "call_dup", ok("second"), deviceId, "key-a"), "duplicate");
    assert.equal((await pending).data, "first");
    // Still a duplicate (not an error) when re-sent from a reconnected connection.
    assert.equal(resultBroker.resolve(crypto.randomUUID(), requestId, "call_dup", ok("third"), deviceId, "key-a"), "duplicate");
    // A call that never existed is distinguishable from a duplicate.
    assert.equal(resultBroker.resolve(conn, requestId, "call_never", ok("x"), deviceId, "key-a"), "unknown");
});

test("a result re-sent after a timeout is treated as a duplicate, not re-run", async () => {
    const requestId = crypto.randomUUID();
    const conn = crypto.randomUUID();
    const outcome = await resultBroker.wait(requestId, "call_late", conn, 5, undefined, "dev-late", "key-a");
    assert.equal(outcome.success, false);
    assert.equal(resultBroker.resolve(conn, requestId, "call_late", ok("late"), "dev-late", "key-a"), "duplicate");
});

test("result after reconnect from the same device and key is accepted", async () => {
    const requestId = crypto.randomUUID();
    const oldConn = crypto.randomUUID();
    const newConn = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const pending = resultBroker.wait(requestId, "call_rc", oldConn, 5000, undefined, deviceId, "key-a");

    // Old connection drops: the call stays pending for the grace window.
    resultBroker.failForDevice(deviceId, "Device disconnected before returning tool result");
    assert.equal(resultBroker.resolve(newConn, requestId, "call_rc", ok("after-reconnect"), deviceId, "key-a"), "accepted");
    assert.equal((await pending).data, "after-reconnect");
    assert.equal(resultBroker.resolve(newConn, requestId, "call_rc", ok("again"), deviceId, "key-a"), "duplicate");
});

test("disconnect fails pending results once the grace window passes", async () => {
    const requestId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const pending = resultBroker.wait(requestId, "call_gone", crypto.randomUUID(), 5000, undefined, deviceId, "key-a");
    resultBroker.failForDevice(deviceId, "gone", 5);
    const outcome = await pending;
    assert.equal(outcome.success, false);
    assert.equal(outcome.error, "gone");
});

test("result from a different API key is rejected even with the right deviceId", async () => {
    const requestId = crypto.randomUUID();
    const conn = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const pending = resultBroker.wait(requestId, "call_key", conn, 5000, undefined, deviceId, "key-a");

    assert.equal(resultBroker.resolve(crypto.randomUUID(), requestId, "call_key", ok("forged"), deviceId, "key-b"), "rejected");
    // Even on the original connection id, a different key is not accepted.
    assert.equal(resultBroker.resolve(conn, requestId, "call_key", ok("forged"), deviceId, "key-b"), "rejected");
    // A different device under the same key on a new connection is rejected too.
    assert.equal(resultBroker.resolve(crypto.randomUUID(), requestId, "call_key", ok("forged"), "other-device", "key-a"), "rejected");
    // The rejection did not consume the call: the real device still gets through.
    assert.equal(resultBroker.resolve(conn, requestId, "call_key", ok("real"), deviceId, "key-a"), "accepted");
    assert.equal((await pending).data, "real");
});

test("duplicate approval responses are ignored after the first one", async () => {
    const requestId = crypto.randomUUID();
    const conn = crypto.randomUUID();
    const owner = { connectionId: conn, apiKeyId: "key-a", deviceId: "dev-appr" };
    const pending = approvalBroker.wait(requestId, "call_appr", 5000, undefined, owner);

    assert.equal(approvalBroker.resolve(requestId, "call_appr", "approve", conn, "key-a", "dev-appr"), "accepted");
    assert.equal(approvalBroker.resolve(requestId, "call_appr", "deny", conn, "key-a", "dev-appr"), "duplicate");
    assert.equal(approvalBroker.resolve(requestId, "call_appr", "approve", conn, "key-a", "dev-appr"), "duplicate");
    assert.equal(await pending, "approve");
});

test("approval re-sent from a new connection is accepted for the same device/key, rejected otherwise", async () => {
    const requestId = crypto.randomUUID();
    const owner = { connectionId: crypto.randomUUID(), apiKeyId: "key-a", deviceId: "dev-appr2" };
    const pending = approvalBroker.wait(requestId, "call_appr2", 5000, undefined, owner);

    assert.equal(approvalBroker.resolve(requestId, "call_appr2", "approve", crypto.randomUUID(), "key-b", "dev-appr2"), "rejected");
    assert.equal(approvalBroker.resolve(requestId, "call_appr2", "approve", crypto.randomUUID(), "key-a", "other-dev"), "rejected");
    assert.equal(approvalBroker.resolve(requestId, "call_appr2", "deny", crypto.randomUUID(), "key-a", "dev-appr2"), "accepted");
    assert.equal(await pending, "deny");
});

test("connection-only approval owner (no device) still requires the same connection", async () => {
    const requestId = crypto.randomUUID();
    const conn = crypto.randomUUID();
    const pending = approvalBroker.wait(requestId, "call_appr3", 5000, undefined, conn);
    assert.equal(approvalBroker.resolve(requestId, "call_appr3", "approve", crypto.randomUUID()), "rejected");
    assert.equal(approvalBroker.resolve(requestId, "call_appr3", "approve", conn), "accepted");
    assert.equal(await pending, "approve");
});
