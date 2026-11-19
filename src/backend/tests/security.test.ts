import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import net from "node:net";
import wsServer from "../server/ws/WebSocketServer";

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
