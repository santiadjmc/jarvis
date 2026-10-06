import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import Log from "../Log";
import type { SynthesizedAudio } from "./PiperEngine";
import { PiperEngine, readSampleRate } from "./PiperEngine";

const MAX_TEXT_CHARS = 1500;
const MAX_CHUNK_CHARS = 500;

export function extractSpeakableSentences(buffer: string): { complete: string; remainder: string } {
    const matches = [...buffer.matchAll(/[.!?](?:\s+|$)|\n+/g)];
    if (matches.length === 0) return { complete: "", remainder: buffer };
    const last = matches[matches.length - 1];
    const cutoff = last.index! + last[0].length;
    return { complete: buffer.slice(0, cutoff), remainder: buffer.slice(cutoff) };
}

class TtsService {
    private piper: PiperEngine | null = null;
    private cacheDir = join(process.env.JARVIS_DATA_DIR || join(homedir(), ".local", "share", "jarvis"), "tts");

    async init(): Promise<void> {
        if (!this.enabled) {
            Log.info("TTS disabled", { enabled: this.enabled });
            return;
        }
        if ((process.env.TTS_ENGINE || "piper").toLowerCase() !== "piper") {
            Log.warn("TTS disabled: only the 'piper' engine is implemented");
            return;
        }
        const engine = new PiperEngine();
        const binaryOk = await engine.checkBinary();
        if (!binaryOk) {
            Log.warn("TTS disabled: piper binary not found or not executable", { binary: engine.binary });
            return;
        }
        if (!engine.isUsable()) {
            Log.warn("TTS disabled: voice model files not found (need both <voice>.onnx and <voice>.onnx.json)", {
                model: engine.modelPath,
                configExpectedAt: `${engine.modelPath}.json`,
            });
            return;
        }
        this.piper = engine;
        Log.info("TTS ready", { engine: "piper", model: engine.modelPath, voiceSpeed: parseFloat(process.env.TTS_SPEED || "1.0") });
    }

    get enabled(): boolean {
        return ["1", "true", "yes"].includes((process.env.TTS_ENABLED || "0").toLowerCase());
    }

    get ready(): boolean {
        return this.enabled && this.piper !== null;
    }

    private cacheFile(text: string): string {
        const voiceFingerprint = `${this.piper?.modelPath ?? "unknown"}:${process.env.TTS_SPEED || "1.0"}`;
        return join(this.cacheDir, `${sha256(`${voiceFingerprint}::${text}`)}.wav`);
    }

    async synthesize(text: string, { cache = true }: { cache?: boolean } = {}): Promise<SynthesizedAudio | null> {
        if (!this.ready || !this.piper) return null;
        const cleaned = cleanForSpeech(text);
        if (!cleaned) return null;

        if (cache) {
            const file = this.cacheFile(cleaned);
            try {
                const audio = await readFile(file);
                return { audio, format: "wav", sampleRate: readSampleRate(audio), durationMs: wavDurationMs(audio) };
            } catch {}
        }

        const chunks = splitChunks(cleaned);
        const parts: Buffer[] = [];
        let sampleRate = 22050;
        for (const chunk of chunks) {
            let audio: Buffer;
            const file = this.cacheFile(chunk);
            if (cache) {
                try {
                    audio = await readFile(file);
                    sampleRate = readSampleRate(audio);
                } catch {
                    const synth = await this.piper.synthesize(chunk);
                    audio = synth.audio;
                    sampleRate = synth.sampleRate;
                    await this.writeCache(file, audio);
                }
            } else {
                const synth = await this.piper.synthesize(chunk);
                audio = synth.audio;
                sampleRate = synth.sampleRate;
            }
            parts.push(audio);
        }

        let audio: Buffer;
        if (parts.length === 1) {
            audio = parts[0];
        } else {
            const pcm = Buffer.concat(parts.map(stripWavHeader));
            audio = buildWav(pcm, sampleRate);
        }

        if (cache) {
            await this.writeCache(this.cacheFile(cleaned), audio);
        }
        return { audio, format: "wav", sampleRate, durationMs: wavDurationMs(audio) };
    }

    private async writeCache(file: string, audio: Buffer): Promise<void> {
        try {
            await mkdir(this.cacheDir, { recursive: true });
            await writeFile(file, audio);
        } catch (err: any) {
            Log.warn("TTS cache write failed", { file, error: err.message });
        }
    }
}

function cleanForSpeech(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/\[(?:[^\]]*)\]\((?:[^)]*)\)/g, "$1")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/[#*_>~|`]/g, " ")
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_TEXT_CHARS);
}

function splitChunks(text: string): string[] {
    const sentences = text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [];
    const chunks: string[] = [];
    let current = "";
    for (const sentence of sentences) {
        const s = sentence.trim();
        if (!s) continue;
        if ((current + " " + s).length > MAX_CHUNK_CHARS && current) {
            chunks.push(current.trim());
            current = "";
        }
        if (s.length > MAX_CHUNK_CHARS) {
            if (current) {
                chunks.push(current.trim());
                current = "";
            }
            let rest = s;
            while (rest.length > MAX_CHUNK_CHARS) {
                const cut = rest.slice(0, MAX_CHUNK_CHARS);
                chunks.push(cut.trim());
                rest = rest.slice(MAX_CHUNK_CHARS);
            }
            current = rest;
        } else {
            current = current ? `${current} ${s}` : s;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

function stripWavHeader(buf: Buffer): Buffer {
    const offset = findDataOffset(buf);
    return offset >= 0 ? buf.subarray(offset) : buf;
}

function findDataOffset(buf: Buffer): number {
    if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF") return -1;
    let offset = 12;
    while (offset + 8 <= buf.length) {
        const id = buf.toString("ascii", offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        if (id === "data") return offset + 8;
        offset += 8 + size + (size % 2);
    }
    return -1;
}

function buildWav(pcm: Buffer, sampleRate: number): Buffer {
    const byteRate = sampleRate * 2;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

function wavDurationMs(buf: Buffer): number {
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return 0;
    const byteRate = buf.readUInt32LE(28);
    if (!byteRate) return 0;
    const dataOffset = findDataOffset(buf);
    const dataLen = dataOffset >= 0 ? buf.length - dataOffset : Math.max(0, buf.length - 44);
    return Math.round((dataLen / byteRate) * 1000);
}

function sha256(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

const ttsService = new TtsService();
export default ttsService;