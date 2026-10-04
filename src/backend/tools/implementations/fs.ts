import { readdir, readFile, writeFile, unlink, mkdir, stat } from "fs/promises";
import { join, resolve, isAbsolute, basename } from "path";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const MAX_READ_BYTES = 65536;

interface DirEntry {
    name: string;
    type: "file" | "dir" | "symlink" | "other";
    size?: number;
}

async function scanDir(path: string, depth: number, limit: number, out: DirEntry[]): Promise<void> {
    if (depth < 0 || out.length >= limit) return;
    let entries;
    try {
        entries = await readdir(path, { withFileTypes: true });
    } catch (err: any) {
        out.push({ name: `<${basename(path)}: ${err.message}>`, type: "other" });
        return;
    }
    for (const entry of entries) {
        if (out.length >= limit) break;
        let size: number | undefined;
        let type: DirEntry["type"] = entry.isFile() ? "file" : entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "symlink" : "other";
        if (type === "file") {
            try {
                size = (await stat(join(path, entry.name))).size;
            } catch {}
        }
        out.push({ name: entry.name, type, size });
        if (type === "dir" && depth > 0) {
            await scanDir(join(path, entry.name), depth - 1, limit, out);
        }
    }
}

const listDir: ToolSpec = {
    name: "list_dir",
    description: "List the contents of a directory with type and file size. Supports limited recursion.",
    category: "file",
    requiresApproval: false,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Absolute directory path (defaults to the user's home directory)" },
            depth: { type: "number", description: "How many levels deep to recurse (default 0, max 3)", default: 0 },
            limit: { type: "number", description: "Max entries to return (default 200)", default: 200 },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const raw = typeof params.path === "string" && params.path ? params.path : process.env.HOME || "/";
        const target = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
        const depth = Math.max(0, Math.min(3, Number(params.depth ?? 0)));
        const limit = Math.max(1, Math.min(500, Number(params.limit ?? 200)));
        const out: DirEntry[] = [];
        await scanDir(target, depth, limit, out);
        return { success: true, data: { path: target, entries: out, truncated: out.length >= limit } };
    },
};

const readFileTool: ToolSpec = {
    name: "read_file",
    description: "Read a file's text content. Large files are truncated to 64KB.",
    category: "file",
    requiresApproval: false,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Absolute path of the file to read" },
        },
        required: ["path"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const raw = typeof params.path === "string" ? params.path : "";
        if (!raw) return { success: false, data: null, error: "path is required" };
        const target = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
        try {
            const info = await stat(target);
            if (info.isDirectory()) return { success: false, data: null, error: `${target} is a directory` };
            const handle = await readFile(target, "utf-8");
            const truncated = handle.length > MAX_READ_BYTES;
            return {
                success: true,
                data: { path: target, size: handle.length, truncated, content: truncated ? handle.slice(0, MAX_READ_BYTES) + "\n...[truncated]" : handle },
            };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const writeFileTool: ToolSpec = {
    name: "write_file",
    description: "Create or overwrite a file with given text content, creating parent directories if needed. Requires user approval.",
    category: "file",
    requiresApproval: true,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Absolute path of the file to write" },
            content: { type: "string", description: "Full text content to write" },
            createParents: { type: "boolean", description: "Create missing parent directories (default true)", default: true },
        },
        required: ["path", "content"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const raw = typeof params.path === "string" ? params.path : "";
        const content = typeof params.content === "string" ? params.content : "";
        if (!raw) return { success: false, data: null, error: "path is required" };
        const target = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
        try {
            if (params.createParents !== false) {
                await mkdir(resolve(target, ".."), { recursive: true });
            }
            await writeFile(target, content);
            return { success: true, data: { path: target, bytes: Buffer.byteLength(content) } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const deleteFileTool: ToolSpec = {
    name: "delete_file",
    description: "Delete a single file. Requires user approval.",
    category: "file",
    requiresApproval: true,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Absolute path of the file to delete" },
        },
        required: ["path"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const raw = typeof params.path === "string" ? params.path : "";
        if (!raw) return { success: false, data: null, error: "path is required" };
        const target = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
        try {
            const info = await stat(target);
            if (info.isDirectory()) return { success: false, data: null, error: `${target} is a directory (use a shell command to delete directories)` };
            await unlink(target);
            return { success: true, data: { path: target, deleted: true } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const fileTools: ToolSpec[] = [listDir, readFileTool, writeFileTool, deleteFileTool];
export default fileTools;