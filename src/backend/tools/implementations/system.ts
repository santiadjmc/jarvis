import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { statfs } from "fs/promises";
import type { ToolContext, ToolResult, ToolSpec } from "../types";
import deviceRegistry from "../../server/ws/DeviceRegistry";

const execFileAsync = promisify(execFile);

function offsetMinutesForZone(date: Date, timeZone: string): number {
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
    const map: Record<string, number> = {};
    for (const part of dtf.formatToParts(date)) {
        if (part.type !== "literal") map[part.type] = Number(part.value);
    }
    const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
    return Math.round((asUTC - date.getTime()) / 60000);
}

function serverTimezone(): string {
    if (process.env.TZ) return process.env.TZ;
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return "UTC";
    }
}

const getSystemInfo: ToolSpec = {
    name: "get_system_info",
    description: "Read-only system overview: hostname, OS, kernel, uptime, CPU count/load, memory, and disk space for /.",
    category: "system",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {},
    },
    async execute(_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        let disk: Record<string, unknown> | undefined;
        try {
            const s = await statfs("/");
            const total = s.blocks * s.bsize;
            const free = s.bavail * s.bsize;
            disk = { totalBytes: total, freeBytes: free, usedBytes: total - free };
        } catch {
            disk = undefined;
        }

        const total = os.totalmem();
        const free = os.freemem();
        return {
            success: true,
            data: {
                hostname: os.hostname(),
                platform: os.platform(),
                release: os.release(),
                arch: os.arch(),
                cpus: os.cpus().length,
                loadavg: os.loadavg(),
                uptimeSeconds: Math.floor(os.uptime()),
                memory: { totalBytes: total, freeBytes: free, usedBytes: total - free },
                disk,
            },
        };
    },
};

const getTime: ToolSpec = {
    name: "get_time",
    description: "Current date and time. Defaults to the server's local timezone; optionally pass an IANA timezone (e.g. America/New_York) to override.",
    category: "system",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            timezone: { type: "string", description: "IANA timezone to use, e.g. UTC or Europe/Berlin. Omit to use the server's timezone." },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const defaultTz = serverTimezone();
        const tz = typeof params.timezone === "string" && params.timezone ? params.timezone : defaultTz;
        try {
            const d = new Date();
            const offsetMinutes = tz === defaultTz ? -d.getTimezoneOffset() : offsetMinutesForZone(d, tz);
            const offset = `${offsetMinutes >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(offsetMinutes) % 60).padStart(2, "0")}`;
            return {
                success: true,
                data: {
                    iso: d.toISOString(),
                    utc: d.toUTCString(),
                    local: d.toLocaleString("en-US", { timeZone: tz }),
                    timezone: tz,
                    timezoneOffset: offset,
                    timezoneOffsetMinutes: offsetMinutes,
                },
            };
        } catch {
            return { success: false, data: null, error: `Invalid timezone: ${tz}` };
        }
    },
};

const listDevices: ToolSpec = {
    name: "list_devices",
    description: "List connected client devices (phones, laptops, etc.) with their stable id, name, type, and tool capabilities. Use to choose where a device_* tool should run.",
    category: "system",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {},
    },
    async execute(_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        return {
            success: true,
            data: deviceRegistry.listForModel(),
        };
    },
};

const listProcesses: ToolSpec = {
    name: "list_processes",
    description: "List running processes with PID, CPU%, memory%, and command line. Filters top consumers by default.",
    category: "system",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            limit: { type: "number", description: "Max processes to return (default 25, max 200)", default: 25 },
            query: { type: "string", description: "Only return processes whose command or name contains this string" },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const limit = Math.max(1, Math.min(200, Number(params.limit ?? 25)));
        const query = typeof params.query === "string" ? params.query.toLowerCase() : "";
        try {
            const { stdout } = await execFileAsync("ps", ["-eo", "pid,pcpu,pmem,comm,args", "--no-headers"], { maxBuffer: 2 * 1024 * 1024 });
            const rows = stdout.split("\n")
                .filter(Boolean)
                .map(line => {
                    const m = line.match(/^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
                    if (!m) return null;
                    return { pid: Number(m[1]), cpu: Number(m[2]), mem: Number(m[3]), name: m[4].split(" ")[0], cmd: m[4].trim() };
                })
                .filter((p): p is NonNullable<typeof p> => p !== null)
                .filter(r => !query || `${r.name} ${r.cmd}`.toLowerCase().includes(query))
                .sort((a, b) => b.cpu - a.cpu)
                .slice(0, limit);
            return { success: true, data: rows };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const killProcess: ToolSpec = {
    name: "kill_process",
    description: "Terminate a process by PID, optionally with a custom signal (default SIGTERM). Requires user approval.",
    category: "system",
    requiresApproval: true,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            pid: { type: "number", description: "PID of the process to terminate" },
            signal: { type: "string", description: "Signal to send, e.g. SIGTERM, SIGKILL (default SIGTERM)", default: "SIGTERM" },
        },
        required: ["pid"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const pid = Number(params.pid);
        const signal = typeof params.signal === "string" ? params.signal : "SIGTERM";
        if (!Number.isInteger(pid) || pid <= 0) return { success: false, data: null, error: "pid must be a positive integer" };
        try {
            process.kill(pid, signal);
            return { success: true, data: { pid, signal } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const systemTools: ToolSpec[] = [getSystemInfo, getTime, listDevices, listProcesses, killProcess];
export default systemTools;