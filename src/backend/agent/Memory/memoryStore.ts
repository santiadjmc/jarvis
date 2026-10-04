import { v4 as uuid } from "uuid";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import ollamaClient from "../../ai/OllamaClient";
import Log from "../../Log";

export interface MemoryEntry {
    id: string;
    content: string;
    type: "fact" | "note";
    embedding?: number[];
    createdAt: number;
}

interface MemoryFile {
    entries: MemoryEntry[];
}

const MAX_ENTRIES = 2000;

function storePath(): string {
    const root = process.env.JARVIS_DATA_DIR || join(homedir(), ".local", "share", "jarvis");
    return join(root, "memory.json");
}

function load(): MemoryFile {
    const path = storePath();
    try {
        if (!existsSync(path)) return { entries: [] };
        return JSON.parse(readFileSync(path, "utf-8")) as MemoryFile;
    } catch {
        return { entries: [] };
    }
}

function save(data: MemoryFile): void {
    const path = storePath();
    mkdirSync(path.substring(0, path.lastIndexOf("/")) || ".", { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
}

async function embed(text: string): Promise<number[] | null> {
    try {
        return await ollamaClient.embedSingle(text);
    } catch (err: any) {
        Log.warn("Memory embedding failed", { error: err.message });
        return null;
    }
}

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function addMemory(content: string, type: "fact" | "note" = "fact"): Promise<string> {
    const data = load();
    const embedding = (await embed(content)) || undefined;
    const entry: MemoryEntry = { id: uuid(), content, type, embedding, createdAt: Date.now() };
    data.entries.push(entry);
    if (data.entries.length > MAX_ENTRIES) {
        data.entries = data.entries.slice(-MAX_ENTRIES);
    }
    save(data);
    return entry.id;
}

export async function searchMemory(query: string, k = 5, minScore = 0.35): Promise<Array<{ content: string; score: number; createdAt: number }>> {
    const data = load();
    if (data.entries.length === 0) return [];

    const queryVec = await embed(query);
    if (!queryVec) {
        const q = query.toLowerCase();
        return data.entries
            .filter(e => e.content.toLowerCase().includes(q))
            .slice(0, k)
            .map(e => ({ content: e.content, score: 1, createdAt: e.createdAt }));
    }

    return data.entries
        .filter(e => e.embedding && e.embedding.length > 0)
        .map(e => ({ content: e.content, score: cosine(queryVec, e.embedding!), createdAt: e.createdAt }))
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
}

export function memoryCount(): number {
    return load().entries.length;
}