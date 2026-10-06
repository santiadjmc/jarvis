import { execFile } from "child_process";
import { promisify } from "util";
import { Socket } from "net";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const execFileAsync = promisify(execFile);

function isValidHost(host: string): boolean {
    return /^[a-zA-Z0-9.\-:]+$/.test(host) && host.length < 256;
}

const pingHost: ToolSpec = {
    name: "ping_host",
    description: "Check whether a host is reachable and measure round-trip latency (ICMP ping).",
    category: "system",
    requiresApproval: false,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            host: { type: "string", description: "Hostname or IP address to ping" },
            count: { type: "number", description: "Number of pings to send (default 3, max 10)", default: 3 },
        },
        required: ["host"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const host = typeof params.host === "string" ? params.host.trim() : "";
        if (!host || !isValidHost(host)) return { success: false, data: null, error: "A valid host is required" };
        const count = Math.max(1, Math.min(10, Number(params.count ?? 3)));
        try {
            const { stdout } = await execFileAsync("ping", ["-c", String(count), "-W", "3", host], { timeout: 12000 });
            const loss = stdout.match(/([\d.]+)% packet loss/);
            const timing = stdout.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/);
            return {
                success: true,
                data: {
                    host,
                    reachable: !loss || Number(loss[1]) < 100,
                    packetLossPercent: loss ? Number(loss[1]) : null,
                    rttMinMs: timing ? Number(timing[1]) : null,
                    rttAvgMs: timing ? Number(timing[2]) : null,
                    rttMaxMs: timing ? Number(timing[3]) : null,
                },
            };
        } catch (err: any) {
            return { success: true, data: { host, reachable: false, packetLossPercent: 100, rttMinMs: null, rttAvgMs: null, rttMaxMs: null }, error: err.message };
        }
    },
};

const checkPort: ToolSpec = {
    name: "check_port",
    description: "Check whether a TCP port is open on a host (e.g. to verify a server is listening).",
    category: "system",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            host: { type: "string", description: "Hostname or IP address" },
            port: { type: "number", description: "TCP port number" },
            timeoutMs: { type: "number", description: "Connection timeout in ms (default 4000)", default: 4000 },
        },
        required: ["host", "port"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const host = typeof params.host === "string" ? params.host.trim() : "";
        const port = Number(params.port);
        if (!host || !isValidHost(host)) return { success: false, data: null, error: "A valid host is required" };
        if (!Number.isInteger(port) || port < 1 || port > 65535) return { success: false, data: null, error: "port must be between 1 and 65535" };
        const timeoutMs = Math.max(500, Math.min(15000, Number(params.timeoutMs ?? 4000)));

        const open = await new Promise<boolean>((resolve) => {
            const socket = new Socket();
            const finish = (result: boolean) => {
                socket.destroy();
                resolve(result);
            };
            socket.setTimeout(timeoutMs);
            socket.once("connect", () => finish(true));
            socket.once("timeout", () => finish(false));
            socket.once("error", () => finish(false));
            socket.connect(port, host);
        });

        return { success: true, data: { host, port, open } };
    },
};

const getPublicIp: ToolSpec = {
    name: "get_public_ip",
    description: "Get this server's public IP address, as seen from the internet.",
    category: "web",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {},
    },
    async execute(_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
            if (!response.ok) return { success: false, data: null, error: `HTTP ${response.status}` };
            const json = await response.json() as { ip: string };
            return { success: true, data: { ip: json.ip } };
        } catch (err: any) {
            return { success: false, data: null, error: err.name === "AbortError" ? "Request timed out" : err.message };
        } finally {
            clearTimeout(timer);
        }
    },
};

const networkTools: ToolSpec[] = [pingHost, checkPort, getPublicIp];
export default networkTools;
