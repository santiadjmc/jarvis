import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import net from "node:net";
import wsServer from "../server/ws/WebSocketServer";
import messageRouter from "../server/ws/MessageRouter";
import authService from "../auth/AuthService";
import deviceRegistry from "../server/ws/DeviceRegistry";
import resultBroker from "../tools/ResultBroker";
import fileTools from "../tools/implementations/fs";
import gitTools from "../tools/implementations/git";
import { stripMarkup } from "../tools/implementations/web";
import { guardedFetch, isPrivateAddress } from "../utils/netguard";
import { checkBrowserRequestUrl } from "../agent/Browser/browserSession";

test("device ids are bound to the authenticating key; spoofed results are rejected (H3)", async () => {
    const deviceId = crypto.randomUUID();
    const info = { deviceId, deviceName: "Victim phone", deviceType: "phone", capabilities: ["device:time"] };
    const victimConn = crypto.randomUUID();
    const attackerConn = crypto.randomUUID();

    assert.equal(deviceRegistry.upsert(victimConn, info, "key-victim"), true);
    assert.equal(deviceRegistry.upsert(attackerConn, info, "key-attacker"), false);
    assert.equal(deviceRegistry.resolveConnection(deviceId, undefined, "key-victim"), victimConn);
    assert.equal(deviceRegistry.resolveConnection("phone", undefined, "key-attacker"), undefined);

    const requestId = crypto.randomUUID();
    const pending = resultBroker.wait(requestId, "call_1", victimConn, 5000, undefined, deviceId, "key-victim");
    assert.equal(resultBroker.resolve(attackerConn, requestId, "call_1", { success: true, data: "forged" }, deviceId, "key-attacker"), false);
    assert.equal(resultBroker.resolve(victimConn, requestId, "call_1", { success: true, data: "real" }, deviceId, "key-victim"), true);
    assert.equal((await pending).data, "real");

    // Same key reconnecting on a new connection is still allowed.
    const newConn = crypto.randomUUID();
    assert.equal(deviceRegistry.upsert(newConn, info, "key-victim"), true);
    deviceRegistry.onClientDisconnect(newConn);
    deviceRegistry.onClientDisconnect(victimConn);
});

test("read_file / grep_files refuse secrets and paths outside allowed roots (H1)", async () => {
    const { mkdtemp, writeFile, mkdir, symlink, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const readTool = fileTools.find(t => t.name === "read_file")!;
    const grepTool = fileTools.find(t => t.name === "grep_files")!;
    const ctx = { clientId: "t", requestId: "t" };

    const root = await mkdtemp(join(tmpdir(), "jarvis-fsguard-"));
    const previous = process.env.JARVIS_FS_ROOTS;
    process.env.JARVIS_FS_ROOTS = root;
    try {
        await writeFile(join(root, "notes.txt"), "hello SECRET_MARKER world");
        await writeFile(join(root, ".env"), "JARVIS_MASTER_KEY=SECRET_MARKER");
        await mkdir(join(root, ".ssh"));
        await writeFile(join(root, ".ssh", "id_ed25519"), "SECRET_MARKER");
        await symlink(join(root, ".env"), join(root, "innocent.txt"));

        assert.equal((await readTool.execute({ path: join(root, "notes.txt") }, ctx)).success, true);
        for (const p of [join(root, ".env"), join(root, ".ssh", "id_ed25519"), join(root, "innocent.txt"), "/proc/self/environ", "/etc/hostname"]) {
            const r = await readTool.execute({ path: p }, ctx);
            assert.equal(r.success, false, `expected ${p} to be refused`);
        }

        const grep = await grepTool.execute({ path: root, pattern: "SECRET_MARKER" }, ctx);
        assert.equal(grep.success, true);
        const paths = (grep.data as any).matches.map((m: any) => m.path);
        assert.deepEqual(paths, [join(root, "notes.txt")]);
    } finally {
        if (previous === undefined) delete process.env.JARVIS_FS_ROOTS;
        else process.env.JARVIS_FS_ROOTS = previous;
        await rm(root, { recursive: true, force: true });
    }
});

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

test("fetch_url HTML stripping is linear-time and still strips markup (H4)", () => {
    const html = '<html><head><style>body{x:1}</style><SCRIPT>var a = "<b>";</SCRIPT></head>' +
        '<body><p class="x">Hello&nbsp;<b>world</b> &amp; 1 &lt; 2</p><>tail<noscript>ns</noscript></body></html>';
    assert.equal(stripMarkup(html, "text/html"), "Hello world & 1 < 2 <>tail");
    assert.equal(stripMarkup("a < b and c", "text/html"), "a < b and c");
    assert.equal(stripMarkup('{"a":"<b>"}', "application/json"), '{"a":"<b>"}');

    for (const payload of ["<".repeat(262144), "<script".repeat(37449), "<a".repeat(131072), "<style><".repeat(32768)]) {
        const started = Date.now();
        stripMarkup(payload, "text/html");
        const elapsed = Date.now() - started;
        assert.ok(elapsed < 1000, `stripMarkup took ${elapsed}ms on a ${payload.length}-char adversarial input`);
    }
});

test("netguard blocks embedded/translated private IPv6 and reserved IPv4 ranges (sec L1)", () => {
    const cases: Array<[string, boolean]> = [
        ["::", true], ["::1", true], ["::127.0.0.1", true], ["::a9fe:a9fe", true],
        ["::ffff:127.0.0.1", true], ["::ffff:7f00:1", true], ["::ffff:8.8.8.8", false],
        ["64:ff9b::a9fe:a9fe", true], ["64:ff9b::169.254.169.254", true], ["64:ff9b::808:808", false], ["64:ff9b:1::1", true],
        ["2002:7f00:1::", true], ["2002:a9fe:a9fe::1", true], ["2002:808:808::1", false],
        ["2001::1", true], ["2001:0:4136:e378::1", true], ["2001:db8::1", true], ["100::1", true],
        ["fec0::1", true], ["feff::1", true], ["fe80::1", true], ["fd00::1", true], ["ff02::1", true],
        ["2606:4700:4700::1111", false], ["2001:4860:4860::8888", false],
        ["192.88.99.1", true], ["198.51.100.7", true], ["203.0.113.9", true], ["10.0.0.1", true], ["8.8.8.8", false],
        ["not-an-ip", true],
    ];
    for (const [address, expected] of cases) {
        assert.equal(isPrivateAddress(address), expected, address);
    }
});

test("guardedFetch strips credentials on cross-origin redirects and downgrades 303 to GET (sec M3)", async () => {
    const seen: Array<{ method?: string; auth?: string; cookie?: string; body: string }> = [];
    const sink = http.createServer((req, res) => {
        let body = "";
        req.on("data", c => { body += c; });
        req.on("end", () => {
            seen.push({ method: req.method, auth: req.headers.authorization, cookie: req.headers.cookie, body });
            res.end("ok");
        });
    });
    await new Promise<void>(resolve => sink.listen(0, "127.0.0.1", resolve));
    const sinkPort = (sink.address() as net.AddressInfo).port;
    const redirector = http.createServer((req, res) => {
        req.resume();
        const status = req.url === "/see-other" ? 303 : 302;
        res.writeHead(status, { Location: `http://localhost:${sinkPort}/landing` });
        res.end();
    });
    await new Promise<void>(resolve => redirector.listen(0, "127.0.0.1", resolve));
    const redirPort = (redirector.address() as net.AddressInfo).port;

    const previous = process.env.JARVIS_FETCH_ALLOW_PRIVATE;
    process.env.JARVIS_FETCH_ALLOW_PRIVATE = "1";
    try {
        const headers = { Authorization: "Bearer secret", Cookie: "sid=1", "X-Other": "kept" };
        await (await guardedFetch(`http://127.0.0.1:${redirPort}/go`, { headers })).text();
        await (await guardedFetch(`http://127.0.0.1:${redirPort}/see-other`, { method: "POST", headers, body: "payload" })).text();
        assert.equal(seen.length, 2);
        for (const hit of seen) {
            assert.equal(hit.auth, undefined);
            assert.equal(hit.cookie, undefined);
        }
        assert.equal(seen[1].method, "GET");
        assert.equal(seen[1].body, "");
    } finally {
        if (previous === undefined) delete process.env.JARVIS_FETCH_ALLOW_PRIVATE;
        else process.env.JARVIS_FETCH_ALLOW_PRIVATE = previous;
        await new Promise<void>(resolve => sink.close(() => resolve()));
        await new Promise<void>(resolve => redirector.close(() => resolve()));
    }
});

test("browser request guard blocks private hosts and non-http schemes (sec H2)", async () => {
    const previous = process.env.JARVIS_FETCH_ALLOW_PRIVATE;
    delete process.env.JARVIS_FETCH_ALLOW_PRIVATE;
    try {
        for (const url of ["http://127.0.0.1:8080/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://localhost/", "file:///etc/passwd", "chrome://settings"]) {
            assert.notEqual(await checkBrowserRequestUrl(url), null, url);
        }
        assert.equal(await checkBrowserRequestUrl("data:text/plain,hi"), null);
        assert.equal(await checkBrowserRequestUrl("http://8.8.8.8/"), null);
    } finally {
        if (previous !== undefined) process.env.JARVIS_FETCH_ALLOW_PRIVATE = previous;
    }
});

test("read-only git tools don't execute repo-configured commands (sec M5)", async () => {
    const { mkdtemp, writeFile, readdir, rm, utimes } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const repo = await mkdtemp(join(tmpdir(), "jarvis-evilrepo-"));
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
    try {
        g("init", "-q", ".");
        g("config", "user.email", "t@example.com");
        g("config", "user.name", "t");
        await writeFile(join(repo, ".gitattributes"), "* filter=evil diff=evil\n");
        await writeFile(join(repo, "f.txt"), "hi\n");
        g("add", ".");
        g("-c", "filter.evil.clean=cat", "commit", "-qm", "init");
        g("config", "core.fsmonitor", `touch ${join(repo, "PWN_fsmonitor")}; false`);
        g("config", "filter.evil.clean", `touch ${join(repo, "PWN_clean")}; cat`);
        g("config", "filter.evil.process", `touch ${join(repo, "PWN_process")}`);
        g("config", "diff.evil.textconv", `touch ${join(repo, "PWN_textconv")}; cat`);
        g("config", "diff.external", `touch ${join(repo, "PWN_external")}`);
        await writeFile(join(repo, "f.txt"), "changed\n");
        await utimes(join(repo, "f.txt"), new Date(2000, 0, 1), new Date(2000, 0, 1));

        const ctx = { clientId: "t", requestId: "t" };
        for (const name of ["git_status", "git_diff", "git_log"]) {
            const tool = gitTools.find(t => t.name === name)!;
            await tool.execute({ repo }, ctx);
        }
        const pwned = (await readdir(repo)).filter(f => f.startsWith("PWN_"));
        assert.deepEqual(pwned, []);
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});
