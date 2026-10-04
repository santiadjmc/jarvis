const WebSocket = require("ws");

const [, , host, key, prompt, approveArg, expectTool] = process.argv;
const approve = approveArg === "approve";
const url = `ws://${host}/ws?key=${encodeURIComponent(key)}`;

const ws = new WebSocket(url);
const toolCalls = new Map();
let toolResults = 0;
let finalModel = null;
let done = false;

const timeout = setTimeout(() => {
    console.error(`TIMEOUT after 180s (toolCalls=${[...toolCalls.values()]}, toolResults=${toolResults})`);
    process.exit(2);
}, 180000);

ws.on("open", () => {
    ws.send(JSON.stringify({
        type: "chat",
        id: crypto.randomUUID(),
        content: prompt,
        stream: true,
        timestamp: Date.now(),
    }));
});

ws.on("message", (raw) => {
    let msg;
    try {
        msg = JSON.parse(raw.toString());
    } catch {
        console.log("PROTOCOL ERROR: bad json");
        process.exit(3);
        return;
    }
    switch (msg.type) {
        case "token":
            if (msg.kind === "assistant") process.stdout.write(msg.content);
            break;
        case "stream_end":
            finalModel = msg.model;
            ws.close();
            break;
        case "tool_call":
            toolCalls.set(msg.callId, msg.tool);
            console.log(`\n[tool_call: ${msg.tool} approval=${msg.approvalRequired}]`);
            if (approve && msg.approvalRequired) {
                ws.send(JSON.stringify({
                    type: "tool_response",
                    id: crypto.randomUUID(),
                    requestId: msg.requestId,
                    callId: msg.callId,
                    action: "approve",
                }));
                console.log(`[approved ${msg.tool}]`);
            }
            break;
        case "tool_result":
            toolResults++;
            console.log(`\n[tool_result: ${msg.tool} success=${msg.success}${msg.error ? ` error=${msg.error}` : ""}]`);
            break;
        case "error":
            console.log(`\n[error: ${msg.code} ${msg.message}]`);
            process.exit(1);
            break;
        case "status":
        case "connected":
        case "pong":
            break;
        default:
            break;
    }
});

ws.on("close", () => {
    clearTimeout(timeout);
    if (done) return;
    done = true;
    const dt = Date.now() - t0;
    console.log("\n---");
    console.log(`tool_calls=${[...toolCalls.values()]} tool_results=${toolResults} model=${finalModel} dt=${dt}ms`);
    const toolsCalled = [...toolCalls.values()];
    let pass = true;
    if (toolsCalled.length === 0) {
        console.log(`FAIL: model did not call any tool`);
        pass = false;
    } else if (!toolsCalled.includes(expectTool)) {
        console.log(`FAIL: expected tool "${expectTool}" was never called (got ${toolsCalled})`);
        pass = false;
    }
    if (!finalModel) {
        console.log("FAIL: no stream_end received");
        pass = false;
    }
    console.log(pass ? "PASS" : "FAIL");
    process.exit(pass ? 0 : 1);
});

ws.on("error", (e) => {
    clearTimeout(timeout);
    console.error(`WS ERROR: ${e.message}`);
    process.exit(1);
});

const t0 = Date.now();