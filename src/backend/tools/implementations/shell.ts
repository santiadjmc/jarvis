import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_CHARS = 12000;
const MAX_COMMAND_TIMEOUT = 30000;

const runCommand: ToolSpec = {
    name: "run_command",
    description: "Run a shell command (bash -lc) on this machine. Returns exit code, stdout and stderr. Requires user approval.",
    category: "code",
    requiresApproval: true,
    timeoutMs: MAX_COMMAND_TIMEOUT + 5000,
    parameters: {
        type: "object",
        properties: {
            command: { type: "string", description: "The shell command to execute" },
            cwd: { type: "string", description: "Working directory (defaults to the user's home directory)" },
            timeoutMs: { type: "number", description: `Max runtime in ms, capped at ${MAX_COMMAND_TIMEOUT} (default 15000)`, default: 15000 },
        },
        required: ["command"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const command = typeof params.command === "string" ? params.command : "";
        if (!command.trim()) return { success: false, data: null, error: "command is required" };
        const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : homedir();
        const timeoutMs = Math.min(MAX_COMMAND_TIMEOUT, Math.round(Number(params.timeoutMs ?? 15000)));

        try {
            const { stdout, stderr } = await execFileAsync("/bin/bash", ["-lc", command], {
                cwd,
                timeout: timeoutMs,
                maxBuffer: 2 * 1024 * 1024,
            });
            return {
                success: true,
                data: {
                    exitCode: 0,
                    stdout: truncate(stdout),
                    stderr: truncate(stderr),
                    command,
                },
            };
        } catch (err: any) {
            const stdOut = truncate(err.stdout || "");
            const stdErr = truncate(err.stderr || "");
            const timedOut = err.killed === true && err.signal === "SIGTERM";
            return {
                success: false,
                data: {
                    exitCode: err.code ?? null,
                    stdout: stdOut,
                    stderr: stdErr,
                    command,
                    timedOut,
                },
                error: timedOut ? `Command timed out after ${timeoutMs}ms` : `Exited with code ${err.code}${stdErr ? `: ${stdErr.slice(0, 300)}` : ""}`,
            };
        }
    },
};

const launchApp: ToolSpec = {
    name: "launch_app",
    description: "Launch an application or open a file/URL using xdg-open. Requires user approval.",
    category: "system",
    requiresApproval: true,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            target: { type: "string", description: "A command name, file path, or URL (http/https) to open" },
            args: { type: "array", description: "Optional extra arguments for command targets", default: [] },
        },
        required: ["target"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const target = typeof params.target === "string" ? params.target : "";
        if (!target.trim()) return { success: false, data: null, error: "target is required" };
        const args = (Array.isArray(params.args) ? params.args : []).map(String);

        try {
            if (/^https?:\/\//i.test(target) || isPathLike(target)) {
                const child = spawn("xdg-open", [target, ...args], { detached: true, stdio: "ignore" });
                child.unref();
                return { success: true, data: { opened: target, via: "xdg-open", pid: child.pid } };
            }
            const child = spawn(target, args, { detached: true, stdio: "ignore" });
            child.unref();
            return { success: true, data: { opened: target, via: "exec", pid: child.pid } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

function isPathLike(value: string): boolean {
    return value.includes("/") && !/\s/.test(value);
}

function truncate(text: string): string {
    if (text.length <= MAX_OUTPUT_CHARS) return text;
    return text.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]";
}

const shellTools: ToolSpec[] = [runCommand, launchApp];
export default shellTools;