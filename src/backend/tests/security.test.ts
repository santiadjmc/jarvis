import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import net from "node:net";
import wsServer from "../server/ws/WebSocketServer";
import messageRouter from "../server/ws/MessageRouter";
import authService from "../auth/AuthService";

test("chat requires chat:send permission (M1)", async () => {
    const sent: any[] = [];
    let handled = 0;
    messageRouter.setAIHandler(async () => { handled++; });
    const fakeWs = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) };
    const noChat = authService.generateKey("no-chat", "user", ["voice:receive"]);
    const withChat = authService.generateKey("with-chat", "user");
    const client = (keyId: string) => ({ id: crypto.randomUUID(), ws: fakeWs, apiKeyId: keyId, role: "user", metadata: {} }) as any;
    const msg = { type: "chat", id: crypto.randomUUID(), content: "hi" } as any;

    await messageRouter.route(client(noChat.id), msg);
    assert.equal(handled, 0);
    assert.equal(sent[0]?.code, "PERMISSION_DENIED");

    await messageRouter.route(client(withChat.id), msg);
    assert.equal(handled, 1);

    // A default "user" key can chat but must not be able to drive tools.
    assert.equal(authService.hasPermission(withChat.id, "tools:execute"), false);
});

test("malformed Host header on WS upgrade does not crash the server (C1)", async () => {
    const server = http.createServer();
    wsServer.attach(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;

    try {
        for (const host of ["a b", "["]) {
            const response = await new Promise<string>((resolve, reject) => {
                const socket = net.connect(port, "127.0.0.1", () => {
                    socket.write(
                        "GET /ws?key=x HTTP/1.1\r\n" +
                        `Host: ${host}\r\n` +
                        "Upgrade: websocket\r\n" +
                        "Connection: Upgrade\r\n" +
                        "Sec-WebSocket-Version: 13\r\n" +
                        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
                    );
                });
                let data = "";
                socket.on("data", chunk => {
                    data += chunk.toString("latin1");
                    socket.destroy();
                    resolve(data);
                });
                socket.on("error", reject);
                socket.setTimeout(3000, () => { socket.destroy(); reject(new Error("timeout")); });
            });
            assert.match(response, /^HTTP\/1\.1 /);
        }
        assert.equal((wsServer as any).extractApiKey({ url: "/ws?key=abc", headers: { host: "a b" } }), "abc");
        assert.ok(server.listening, "server still listening after malformed Host");
    } finally {
        wsServer.stop();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
