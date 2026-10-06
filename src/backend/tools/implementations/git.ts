import { execFile } from "child_process";
import { promisify } from "util";
import { isAbsolute, resolve } from "path";
import { homedir } from "os";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_CHARS = 12000;

function resolveRepo(params: Record<string, unknown>): string {
    const raw = typeof params.repo === "string" && params.repo ? params.repo : homedir();
    return isAbsolute(raw) ? resolve(raw) : resolve(homedir(), raw);
}

function truncate(text: string): string {
    return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]" : text;
}

async function git(repo: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", ["-C", repo, ...args], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
}

const repoParam = { type: "string", description: "Absolute path to the git repository (defaults to the home directory)" };

const gitStatus: ToolSpec = {
    name: "git_status",
    description: "Show the working tree status of a git repository (changed, staged, and untracked files).",
    category: "code",
    requiresApproval: false,
    timeoutMs: 15000,
    parameters: { type: "object", properties: { repo: repoParam } },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const repo = resolveRepo(params);
        try {
            const { stdout: branch } = await git(repo, ["branch", "--show-current"]);
            const { stdout } = await git(repo, ["status", "--porcelain=v1", "-b"]);
            return { success: true, data: { repo, branch: branch.trim(), status: truncate(stdout) } };
        } catch (err: any) {
            return { success: false, data: null, error: err.stderr?.trim() || err.message };
        }
    },
};

const gitLog: ToolSpec = {
    name: "git_log",
    description: "Show recent commit history for a git repository.",
    category: "code",
    requiresApproval: false,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            repo: repoParam,
            count: { type: "number", description: "Number of commits to show (default 10, max 50)", default: 10 },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const repo = resolveRepo(params);
        const count = Math.max(1, Math.min(50, Number(params.count ?? 10)));
        try {
            const { stdout } = await git(repo, ["log", `-${count}`, "--pretty=format:%H|%an|%ar|%s"]);
            const commits = stdout.split("\n").filter(Boolean).map(line => {
                const [hash, author, date, ...rest] = line.split("|");
                return { hash, author, date, message: rest.join("|") };
            });
            return { success: true, data: { repo, commits } };
        } catch (err: any) {
            return { success: false, data: null, error: err.stderr?.trim() || err.message };
        }
    },
};

const gitDiff: ToolSpec = {
    name: "git_diff",
    description: "Show the diff of uncommitted changes in a git repository, optionally for a specific file.",
    category: "code",
    requiresApproval: false,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            repo: repoParam,
            path: { type: "string", description: "Only show the diff for this file (relative to repo root)" },
            staged: { type: "boolean", description: "Show staged changes instead of unstaged (default false)", default: false },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const repo = resolveRepo(params);
        const args = ["diff"];
        if (params.staged === true) args.push("--staged");
        if (typeof params.path === "string" && params.path) args.push("--", params.path);
        try {
            const { stdout } = await git(repo, args);
            return { success: true, data: { repo, diff: truncate(stdout) || "(no changes)" } };
        } catch (err: any) {
            return { success: false, data: null, error: err.stderr?.trim() || err.message };
        }
    },
};

const gitCommit: ToolSpec = {
    name: "git_commit",
    description: "Stage all changes and create a git commit with the given message. Requires user approval.",
    category: "code",
    requiresApproval: true,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            repo: repoParam,
            message: { type: "string", description: "Commit message" },
        },
        required: ["message"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const repo = resolveRepo(params);
        const message = typeof params.message === "string" ? params.message.trim() : "";
        if (!message) return { success: false, data: null, error: "message is required" };
        try {
            await git(repo, ["add", "-A"]);
            const { stdout } = await git(repo, ["commit", "-m", message]);
            return { success: true, data: { repo, message, output: truncate(stdout) } };
        } catch (err: any) {
            return { success: false, data: null, error: err.stderr?.trim() || err.message };
        }
    },
};

const gitTools: ToolSpec[] = [gitStatus, gitLog, gitDiff, gitCommit];
export default gitTools;
