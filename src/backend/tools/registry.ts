import { randomUUID } from "crypto";
import type { OllamaTool } from "../types/ai";
import type { ToolCategory } from "../types/agent";
import Log from "../Log";
import deviceRegistry from "../server/ws/DeviceRegistry";
import systemTools from "./implementations/system";
import fileTools from "./implementations/fs";
import shellTools from "./implementations/shell";
import webTools from "./implementations/web";
import memoryTools from "./implementations/memory";
import scheduleTools from "./implementations/schedule";
import codeTools from "./implementations/code";
import emailTools from "./implementations/email";
import networkTools from "./implementations/network";
import utilityTools from "./implementations/utility";
import gitTools from "./implementations/git";
import calendarTools from "./implementations/calendar";
import browserTools from "./implementations/browser";
import gmailTools from "./implementations/gmail";
import googleCalendarTools from "./implementations/googleCalendar";
import driveTools from "./implementations/drive";
import youtubeTools from "./implementations/youtube";
import googleAccountTools from "./implementations/googleAccount";
import deviceTools from "./deviceTools";
import type { ToolResult, ToolResultMessagePayload, ToolSpec } from "./types";

const MAX_RESULT_CHARS = 8000;

class ToolRegistry {
    private specs = new Map<string, ToolSpec>();
    private initialized = false;

    private init(): void {
        if (this.initialized) return;
        this.initialized = true;
        for (const spec of [...systemTools, ...fileTools, ...shellTools, ...webTools, ...memoryTools, ...scheduleTools, ...codeTools, ...emailTools, ...networkTools, ...utilityTools, ...gitTools, ...calendarTools, ...browserTools, ...gmailTools, ...googleCalendarTools, ...driveTools, ...youtubeTools, ...googleAccountTools, ...deviceTools]) {
            this.specs.set(spec.name, spec);
        }
        Log.info("Tool registry initialized", { tools: this.specs.size });
    }

    enabled(name: string): boolean {
        const raw = (process.env.JARVIS_TOOLS || "*").trim();
        if (raw === "*") return true;
        if (raw.toLowerCase() === "none") return false;
        const entries = raw.split(",").map(s => s.trim()).filter(Boolean);
        const excludes = entries.filter(e => e.startsWith("-")).map(e => e.slice(1).toLowerCase());
        const includes = entries.filter(e => !e.startsWith("-")).map(e => e.toLowerCase());
        if (includes.length === 0 && excludes.length > 0) {
            return !excludes.includes(name.toLowerCase());
        }
        return includes.includes(name.toLowerCase());
    }

    private deviceToolAllowed(name: string): boolean {
        const raw = (process.env.JARVIS_DEVICE_TOOLS || "*").trim();
        if (raw.toLowerCase() === "none") return false;
        if (raw === "*") return true;
        return raw.split(",").map(s => s.trim().toLowerCase()).includes(name.toLowerCase());
    }

    advertised(name: string): boolean {
        this.init();
        const spec = this.specs.get(name);
        if (!spec || !this.enabled(name)) return false;
        if (spec.runtime !== "device") return true;
        return this.deviceToolAllowed(name) && deviceRegistry.hasCapability(spec.capability);
    }

    list(): string[] {
        this.init();
        return Array.from(this.specs.keys()).filter(name => this.advertised(name)).sort();
    }

    get(name: string): ToolSpec | undefined {
        this.init();
        return this.specs.get(name);
    }

    has(name: string): boolean {
        return this.get(name) !== undefined;
    }

    requiresApproval(name: string): boolean {
        return this.get(name)?.requiresApproval ?? false;
    }

    isSafeForAutonomousRun(name: string): boolean {
        const spec = this.get(name);
        return !!spec && !spec.requiresApproval && spec.runtime !== "device";
    }

    categories(): Record<ToolCategory, string[]> {
        this.init();
        const out = { system: [], web: [], file: [], code: [], memory: [], utility: [], schedule: [], communication: [] } as Record<ToolCategory, string[]>;
        for (const name of this.list()) {
            const spec = this.get(name);
            if (spec) out[spec.category].push(name);
        }
        return out;
    }

    defsForOllama(opts: { safeOnly?: boolean } = {}): OllamaTool[] {
        this.init();
        return this.list()
            .map(name => this.get(name))
            .filter((spec): spec is ToolSpec => !!spec)
            .filter(spec => !opts.safeOnly || (!spec.requiresApproval && spec.runtime !== "device"))
            .map(spec => ({
                type: "function" as const,
                function: {
                    name: spec.name,
                    description: spec.description,
                    parameters: spec.parameters as unknown as Record<string, unknown>,
                },
            }));
    }

    async execute(name: string, params: Record<string, unknown>, ctx: { clientId: string; requestId: string }): Promise<ToolResult> {
        const spec = this.get(name);
        if (!spec) return { success: false, data: null, error: `Unknown tool: ${name}`, executionTimeMs: 0 };
        if (!this.enabled(name)) return { success: false, data: null, error: `Tool disabled: ${name}`, executionTimeMs: 0 };
        if (spec.runtime === "device") {
            return { success: false, data: null, error: `${name} runs on a client device, not the server`, executionTimeMs: 0 };
        }

        const startedAt = Date.now();
        try {
            const result = await this.withTimeout(spec.execute(params, ctx), spec.timeoutMs);
            const elapsed = Date.now() - startedAt;
            if (!result || typeof result.success !== "boolean") {
                return { success: false, data: null, error: "Tool returned an invalid result", executionTimeMs: elapsed };
            }
            const finalResult: ToolResult = { success: result.success, data: result.data, error: result.error, executionTimeMs: elapsed };
            Log.info("Tool executed", { tool: name, success: finalResult.success, ms: elapsed, clientId: ctx.clientId });
            return finalResult;
        } catch (err: any) {
            const elapsed = Date.now() - startedAt;
            Log.warn("Tool threw", { tool: name, error: err.message, ms: elapsed });
            return { success: false, data: null, error: err.name === "ToolTimeout" ? `Tool timed out after ${spec.timeoutMs}ms` : err.message, executionTimeMs: elapsed };
        }
    }

    sendable(name: string, result: ToolResult, opts: { requestId: string; callId: string }): ToolResultMessagePayload {
        return {
            type: "tool_result",
            id: randomUUID(),
            requestId: opts.requestId,
            tool: name,
            callId: opts.callId,
            success: result.success,
            data: result.data === undefined ? null : result.data,
            error: result.error,
        };
    }

    serializeForModel(name: string, result: ToolResult): string {
        const payload = { tool: name, success: result.success, data: result.data, error: result.error };
        const json = JSON.stringify(truncateDeep(payload, MAX_RESULT_CHARS));
        return json.length > MAX_RESULT_CHARS ? json.slice(0, MAX_RESULT_CHARS) + "\n...[truncated]" : json;
    }

    private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        if (!Number.isFinite(ms) || ms <= 0) return promise;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                const err = new Error("tool timeout") as Error & { name: string };
                err.name = "ToolTimeout";
                reject(err);
            }, ms);
            promise.then(
                value => {
                    clearTimeout(timer);
                    resolve(value);
                },
                err => {
                    clearTimeout(timer);
                    reject(err);
                },
            );
        });
    }
}

function truncateDeep(value: unknown, max: number): unknown {
    if (typeof value === "string") {
        return value.length > max ? value.slice(0, max) + "\n...[truncated]" : value;
    }
    if (Array.isArray(value)) return value.map(v => truncateDeep(v, max));
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = truncateDeep(v, max);
        }
        return out;
    }
    if (typeof value === "bigint") return value.toString();
    return value;
}

const toolRegistry = new ToolRegistry();
export default toolRegistry;