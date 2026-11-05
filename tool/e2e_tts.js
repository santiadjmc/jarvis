const WebSocket = require("ws");
const fs = require("fs");

const [, , host, prompt] = process.argv;
const key = process.env.JARVIS_API_KEY;
if (!key) {
    console.error("Missing API key: set the JARVIS_API_KEY environment variable (usage: node tool/e2e_tts.js <host> <prompt>)");
    process.exit(2);
}
const url = `ws://${host}/ws?key=${encodeURIComponent(key)}`;

const ws = new WebSocket(url);
const voiceId = crypto.randomUUID();
const speakId = crypto.randomUUID();
let streamReqId = null;
let sawAutoVoice = false;
let sawSpeakVoice = false;
let done = false;

const timeout = setTimeout(() => {
    console.error(`TIMEOUT (autoVoice=${sawAutoVoice} speakVoice=${sawSpeakVoice})`);
    process.exit(2);
}, 120000);

function checkRiff(b64, name) {
    const buf = Buffer.from(b64, "base64");
    const riff = buf.toString("ascii", 0, 4) === "RIFF";
    const wave = buf.toString("ascii", 8, 12) === "WAVE";
    const rate = buf.readUInt32LE(24);
    console.log(`[${name}] bytes=${buf.length} riff=${riff} wave=${wave} sampleRate=${rate} (~${Math.round(buf.length / 22050)}s)`);
    fs.writeFileSync(`/tmp/opencode/${name}.wav`, buf);
    return riff && wave && rate === 22050;
}

ws.on("open", () => {
    ws.send(JSON.stringify({
        type: "chat",
        id: voiceId,
        content: prompt,
        stream: true,
        voice: true,
        timestamp: Date.now(),
    }));
    setTimeout(() => {
        ws.send(JSON.stringify({
            type: "speak",
            id: speakId,
            text: "Synthesized speech is working",
            timestamp: Date.now(),
        }));
    }, 1500);
});

ws.on("message", (raw) => {
    let msg;
    try {
        msg = JSON.parse(raw.toString());
    } catch {
        return;
    }
    switch (msg.type) {
        case "token":
            process.stdout.write(msg.content);
            break;
        case "voice":
            if (msg.requestId === streamReqId) {
                sawAutoVoice = checkRiff(msg.audio, "tts_auto");
            } else if (msg.requestId === speakId) {
                sawSpeakVoice = checkRiff(msg.audio, "tts_speak");
            }
            if (sawAutoVoice && sawSpeakVoice && !done) {
                done = true;
                clearTimeout(timeout);
                ws.close();
            }
            break;
        case "stream_end":
            streamReqId = msg.requestId;
            console.log("\n[stream_end]");
            break;
        case "status":
            process.stdout.write(`[${msg.status}] `);
            break;
        case "error":
            console.log(`\n[error: ${msg.code} ${msg.message}]`);
            process.exit(1);
            break;
    }
});

ws.on("close", () => {
const ok = sawAutoVoice && sawSpeakVoice;
console.log(`\nRESULT: ${ok ? "PASS" : "FAIL"}`);
    process.exit(ok ? 0 : 1);
});