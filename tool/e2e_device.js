const WebSocket = require("ws");

const [, , host, key, mode, prompt, reconnectPrompt] = process.argv;
const approve = process.argv.includes("approve");
const reconnect = process.argv.includes("reconnect");
const url = `http://${host}/ws?key=${encodeURIComponent(key)}`.replace("http://", "ws://");

const deviceId = mode === "device" ? "dev-sim-1" : "dev-sim-2";
const deviceName = mode === "device" ? "Sim Phone" : "Sim Desktop";
const capabilities = [
    "device:time",
    "device:info",
    "device:open_url",
    "device:set_clipboard",
    "device:get_clipboard",
    "device:run_command",
];

let ws;
let toolCalls = 0;
let deviceExecuted = 0;
let toolResults = 0;
let streamEnds = 0;
let requestId = null;
const timeout = setTimeout(() => {
    console.error(`TIMEOUT after 180s (toolCalls=${toolCalls} deviceExecuted=${deviceExecuted} results=${toolResults} ends=${streamEnds})`);
    process.exit(2);
}, 180000);

function hello() {
    ws.send(JSON.stringify({
        type: "device_hello",
        id: crypto.randomUUID(),
        deviceId,
        deviceName,
        deviceType: "linux",
        capabilities,
    }));
    console.log(`[hello] ${deviceName} (${deviceId}) registered`);
}

function sendChat() {
    const content = reconnect && reconnectPrompt && streamEnds === 1 ? reconnectPrompt : prompt;
    ws.send(JSON.stringify({
        type: "chat",
        id: crypto.randomUUID(),
        content,
        stream: true,
        timestamp: Date.now(),
    }));
    console.log(`[chat] sent: ${content}`);
}

function connect() {
    ws = new WebSocket(url);
    ws.on("open", () => {
        hello();
        if (mode === "requester") sendChat();
    });
    ws.on("message", (raw) => handleMessage(JSON.parse(raw.toString())));
    ws.on("close", () => {
        if (reconnect && mode === "requester" && streamEnds < 2) {
            console.log("[reconnect] reconnecting…");
            setTimeout(connect, 500);
        } else {
            finish();
        }
    });
    ws.on("error", (e) => {
        clearTimeout(timeout);
        console.error(`WS ERROR: ${e.message}`);
        process.exit(1);
    });
}

function handleMessage(msg) {
    switch (msg.type) {
        case "connected":
            console.log(`[connected] clientId=${msg.clientId} serverEchoDeviceId=${msg.deviceId}`);
            break;
        case "tool_call":
            toolCalls++;
            if (msg.executor === "device") {
                deviceExecuted++;
                requestId = msg.requestId;
                console.log(`\n[device tool_call: ${msg.tool} approval=${msg.approvalRequired} params=${JSON.stringify(msg.params)}]`);
                if (approve || !msg.approvalRequired) {
                    const data = simulateResult(msg.tool, msg.params);
                    console.log(`[simulate running ${msg.tool}]`);
                    ws.send(JSON.stringify({
                        type: "tool_execute_result",
                        id: crypto.randomUUID(),
                        requestId: msg.requestId,
                        callId: msg.callId,
                        success: true,
                        data,
                        executionTimeMs: 12,
                    }));
                    console.log(`[tool_execute_result sent for ${msg.tool}]`);
                } else {
                    console.log(`[simulate denial of ${msg.tool}]`);
                    ws.send(JSON.stringify({
                        type: "tool_execute_result",
                        id: crypto.randomUUID(),
                        requestId: msg.requestId,
                        callId: msg.callId,
                        success: false,
                        error: "Denied (simulated)",
                    }));
                }
            } else if (mode === "requester") {
                console.log(`\n[tool_call: ${msg.tool} approval=${msg.approvalRequired}]`);
                if (msg.approvalRequired && approve) {
                    ws.send(JSON.stringify({
                        type: "tool_response",
                        id: crypto.randomUUID(),
                        requestId: msg.requestId,
                        callId: msg.callId,
                        action: "approve",
                    }));
                }
            }
            break;
        case "tool_result":
            toolResults++;
            console.log(`\n[tool_result: ${msg.tool} success=${msg.success}${msg.error ? ` error=${msg.error}` : ""}]`);
            break;
        case "status":
            if (msg.status === "tool_calling") console.log(`[status] ${msg.detail || "tool_calling"}`);
            break;
        case "stream_end":
            streamEnds++;
            console.log(`\n[stream_end #${streamEnds} model=${msg.model}]`);
            if (streamEnds >= (reconnect ? 2 : 1)) ws.close();
            break;
        case "token":
            if (msg.kind === "assistant") process.stdout.write(msg.content);
            break;
        case "error":
            console.log(`\n[error: ${msg.code} ${msg.message}]`);
            ws.close();
            break;
        default:
            break;
    }
}

function simulateResult(tool, params) {
    switch (tool) {
        case "list_devices":
            return [];
        case "device_get_time":
            return {
                iso: new Date().toISOString(),
                unixMs: Date.now(),
                local: "14:22",
                date: "2026-09-06",
                timezone: "CEST",
                timezoneOffsetMinutes: 120,
            };
        case "device_get_info":
            return { deviceId, deviceName, deviceType: "linux", screen: { widthPx: 1920, heightPx: 1080 } };
        case "device_get_clipboard":
            return { text: "", isEmpty: true };
        case "device_set_clipboard":
            return { copiedChars: (params.text || "").length };
        case "device_open_url":
            return null;
        case "device_vibrate":
            return null;
        case "device_run_command":
            return { exitCode: 0, stdout: "hello from sim device", stderr: "" };
        default:
            return null;
    }
}

function finish() {
    clearTimeout(timeout);
    let pass = true;
    console.log("\n---");
    console.log(`mode=${mode} toolCalls=${toolCalls} deviceExecuted=${deviceExecuted} toolResults=${toolResults} streamEnds=${streamEnds}`);
    if (mode === "device") {
        if (deviceExecuted === 0) {
            console.log("FAIL: device never executed a device tool");
            pass = false;
        }
    } else {
        if (streamEnds === 0) {
            console.log("FAIL: no stream_end for requester");
            pass = false;
        }
        if (deviceExecuted === 0) {
            console.log("FAIL: requester never executed/handled a device tool");
            pass = false;
        }
        if (reconnect && streamEnds < 2) {
            console.log("FAIL: expected second stream_end after reconnect");
            pass = false;
        }
    }
    console.log(pass ? "PASS" : "FAIL");
    process.exit(pass ? 0 : 1);
}

connect();