import { readdir, readFile, writeFile, unlink, mkdir, stat, rename, copyFile, appendFile } from "fs/promises";
import { join, resolve, isAbsolute, basename, dirname } from "path";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const MAX_READ_BYTES = 65536;
const SKIP_DIR_NAMES = new Set(["node_modules", ".git", ".dart_tool", "build", "dist", ".cache"]);

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

const appendFileTool: ToolSpec = {
    name: "append_file",
    description: "Append text content to the end of a file, creating it (and parent directories) if it doesn't exist yet. Requires user approval.",
    category: "file",
    requiresApproval: true,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Absolute path of the file to append to" },
            content: { type: "string", description: "Text content to append" },
        },
        required: ["path", "content"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const raw = typeof params.path === "string" ? params.path : "";
        const content = typeof params.content === "string" ? params.content : "";
        if (!raw) return { success: false, data: null, error: "path is required" };
        const target = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
        try {
            await mkdir(dirname(target), { recursive: true });
            await appendFile(target, content);
            return { success: true, data: { path: target, appendedBytes: Buffer.byteLength(content) } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const moveFileTool: ToolSpec = {
    name: "move_file",
    description: "Move or rename a file. Requires user approval.",
    category: "file",
    requiresApproval: true,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            from: { type: "string", description: "Absolute path of the file to move" },
            to: { type: "string", description: "Absolute destination path" },
        },
        required: ["from", "to"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const from = typeof params.from === "string" ? params.from : "";
        const to = typeof params.to === "string" ? params.to : "";
        if (!from || !to) return { success: false, data: null, error: "from and to are required" };
        const src = isAbsolute(from) ? resolve(from) : resolve(process.cwd(), from);
        const dest = isAbsolute(to) ? resolve(to) : resolve(process.cwd(), to);
        try {
            await mkdir(dirname(dest), { recursive: true });
            await rename(src, dest);
            return { success: true, data: { from: src, to: dest } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const copyFileTool: ToolSpec = {
    name: "copy_file",
    description: "Copy a file to a new location. Requires user approval.",
    category: "file",
    requiresApproval: true,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            from: { type: "string", description: "Absolute path of the file to copy" },
            to: { type: "string", description: "Absolute destination path" },
        },
        required: ["from", "to"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const from = typeof params.from === "string" ? params.from : "";
        const to = typeof params.to === "string" ? params.to : "";
        if (!from || !to) return { success: false, data: null, error: "from and to are required" };
        const src = isAbsolute(from) ? resolve(from) : resolve(process.cwd(), from);
        const dest = isAbsolute(to) ? resolve(to) : resolve(process.cwd(), to);
        try {
            await mkdir(dirname(dest), { recursive: true });
            await copyFile(src, dest);
            return { success: true, data: { from: src, to: dest } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

async function walk(dir: string, maxDepth: number, visit: (path: string, depth: number) => Promise<boolean>, depth = 0): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (SKIP_DIR_NAMES.has(entry.name)) continue;
            await walk(join(dir, entry.name), maxDepth, visit, depth + 1);
        } else if (entry.isFile()) {
            const keepGoing = await visit(join(dir, entry.name), depth);
            if (!keepGoing) return;
        }
    }
}

const searchFiles: ToolSpec = {
    name: "search_files",
    description: "Find files by name under a directory (recursive, case-insensitive substring match on the filename).",
    category: "file",
    requiresApproval: false,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Directory to search under (defaults to the user's home directory)" },
            query: { type: "string", description: "Substring to match against file names" },
            maxDepth: { type: "number", description: "Max recursion depth (default 6)", default: 6 },
            limit: { type: "number", description: "Max results (default 100)", default: 100 },
        },
        required: ["query"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const query = typeof params.query === "string" ? params.query.toLowerCase().trim() : "";
        if (!query) return { success: false, data: null, error: "query is required" };
        const raw = typeof params.path === "string" && params.path ? params.path : process.env.HOME || "/";
        const root = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
        const maxDepth = Math.max(0, Math.min(12, Number(params.maxDepth ?? 6)));
        const limit = Math.max(1, Math.min(500, Number(params.limit ?? 100)));

        const matches: string[] = [];
        await walk(root, maxDepth, async (path) => {
            if (basename(path).toLowerCase().includes(query)) matches.push(path);
            return matches.length < limit;
        });

        return { success: true, data: { root, query, matches, truncated: matches.length >= limit } };
    },
};

const grepFiles: ToolSpec = {
    name: "grep_files",
    description: "Search file contents for a text pattern under a directory (recursive). Skips binary-looking files and anything over 2MB.",
    category: "file",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Directory to search under (defaults to the user's home directory)" },
            pattern: { type: "string", description: "Text to search for (case-insensitive substring)" },
            maxDepth: { type: "number", description: "Max recursion depth (default 6)", default: 6 },
            limit: { type: "number", description: "Max matching lines to return (default 100)", default: 100 },
        },
        required: ["pattern"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const pattern = typeof params.pattern === "string" ? params.pattern : "";
        if (!pattern.trim()) return { success: false, data: null, error: "pattern is required" };
        const needle = pattern.toLowerCase();
        const raw = typeof params.path === "string" && params.path ? params.path : process.env.HOME || "/";
        const root = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
        const maxDepth = Math.max(0, Math.min(12, Number(params.maxDepth ?? 6)));
        const limit = Math.max(1, Math.min(500, Number(params.limit ?? 100)));

        const matches: Array<{ path: string; line: number; text: string }> = [];
        await walk(root, maxDepth, async (path) => {
            try {
                const info = await stat(path);
                if (info.size > 2 * 1024 * 1024) return matches.length < limit;
                const content = await readFile(path, "utf-8");
                if (content.includes("\u0000")) return matches.length < limit;
                const lines = content.split("\n");
                for (let i = 0; i < lines.length && matches.length < limit; i++) {
                    if (lines[i].toLowerCase().includes(needle)) {
                        matches.push({ path, line: i + 1, text: lines[i].trim().slice(0, 300) });
                    }
                }
            } catch {}
            return matches.length < limit;
        });

        return { success: true, data: { root, pattern, matches, truncated: matches.length >= limit } };
    },
};

const fileTools: ToolSpec[] = [
    listDir,
    readFileTool,
    writeFileTool,
    deleteFileTool,
    appendFileTool,
    moveFileTool,
    copyFileTool,
    searchFiles,
    grepFiles,
];
export default fileTools;