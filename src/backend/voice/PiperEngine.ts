import { spawn } from "child_process";
import { accessSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

export interface SynthesizedAudio {
    audio: Buffer;
    format: "wav";
    sampleRate: number;
    durationMs: number;
}

function defaultPiperBinary(): string {
    const candidates = [
        process.env.TTS_PIPER_BIN,
        join(homedir(), ".local", "share", "piper-venv", "bin", "piper"),
        "/usr/local/bin/piper",
        "/usr/bin/piper",
    ].filter((p): p is string => !!p);
    for (const candidate of candidates) {
        try {
            accessSync(candidate);
            return candidate;
        } catch {}
    }
    return "piper";
}

function resolveModelPath(): string {
    const voice = process.env.TTS_VOICE || "en_US-ryan-high";
    if (voice.includes("/") || voice.endsWith(".onnx")) return voice;
    const dir = process.env.TTS_MODEL_DIR || join(homedir(), ".local", "share", "jarvis", "piper");
    return join(dir, `${voice}.onnx`);
}

export class PiperEngine {
    readonly binary: string;
    readonly modelPath: string;
    private readonly lengthScale: number;

    constructor() {
        this.binary = defaultPiperBinary();
        this.modelPath = resolveModelPath();
        this.lengthScale = parseFloat(process.env.TTS_SPEED || "1.0");
    }

    isUsable(): boolean {
        try {
            accessSync(this.modelPath);
            accessSync(`${this.modelPath}.json`);
            return true;
        } catch {
            return false;
        }
    }

    checkBinary(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const child = spawn(this.binary, ["--help"]);
            child.on("error", () => resolve(false));
            child.on("close", (code) => resolve(code === 0));
        });
    }

    synthesize(text: string): Promise<SynthesizedAudio> {
        const outPath = join(process.env.TMPDIR || "/tmp", `jarvis_tts_${randomUUID()}.wav`);
        const args = ["-m", this.modelPath, "-f", outPath];
        if (this.lengthScale !== 1.0) args.push("--length-scale", String(this.lengthScale));

        return new Promise<SynthesizedAudio>((resolve, reject) => {
            const child = spawn(this.binary, args);
            let stderr = "";
            child.stderr.on("data", (d: Buffer) => {
                stderr += d.toString();
            });
            child.on("error", (err) => {
                reject(err);
            });
            child.on("close", async (code) => {
                if (code !== 0) {
                    reject(new Error(`piper exited with code ${code}: ${stderr.slice(0, 300)}`));
                    return;
                }
                try {
                    const audio = await readFile(outPath);
                    await unlink(outPath).catch(() => {});
                    resolve({ audio, format: "wav", sampleRate: readSampleRate(audio), durationMs: wavDurationMs(audio) });
                } catch (err: any) {
                    reject(err);
                }
            });
            child.stdin.end(text);
        });
    }
}

export function readSampleRate(buf: Buffer): number {
    if (buf.length < 28 || buf.toString("ascii", 0, 4) !== "RIFF") return 22050;
    return buf.readUInt32LE(24) || 22050;
}

function wavDurationMs(buf: Buffer): number {
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return 0;
    const byteRate = buf.readUInt32LE(28);
    if (!byteRate) return 0;
    const dataOffset = findDataOffset(buf);
    const dataLen = dataOffset >= 0 ? buf.length - dataOffset : buf.length - 44;
    return Math.round((dataLen / byteRate) * 1000);
}

function findDataOffset(buf: Buffer): number {
    let offset = 12;
    while (offset + 8 <= buf.length) {
        const id = buf.toString("ascii", offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        if (id === "data") return offset + 8;
        offset += 8 + size + (size % 2);
    }
    return -1;
}
