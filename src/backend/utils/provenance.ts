import Log from "../Log";
import type { ToolResult } from "../tools/types";

/**
 * Provenance tracking for prompt-injection guardrails (sec M2).
 *
 * A conversation becomes "tainted" the first time a tool returns external,
 * attacker-controllable content (mail, web pages, search results, Drive,
 * the browser, device screen/clipboard, untrusted memories). The taint is
 * sticky for the conversation's lifetime. Tool calls made while a
 * conversation is tainted carry `origin: "external"`, and the persistence
 * tools (schedule_task, delegate_task, remember) apply guardrails instead of
 * asking for approval:
 *
 * - scheduled tasks and subagents created from tainted context run with a
 *   small read-only, non-network tool set and are capped (tasks also have a
 *   minimum repeat interval);
 * - memories are stored as untrusted and loaded into prompts only as quoted
 *   notes, not instructions.
 *
 * Every guarded action is logged with the "Provenance guard" prefix.
 */

export type Origin = "user" | "external";

/** Snapshot passed to tools through ToolContext. */
export interface Provenance {
    tainted: boolean;
    sources: string[];
}

/** Live per-conversation state (kept on the Conversation object). */
export interface ProvenanceState {
    tainted: boolean;
    sources: Set<string>;
    /** Fingerprints of local data read in this conversation (see egressGuard). */
    localShingles?: Set<string>;
    localText?: string;
}

/** Tools whose output is external content the user didn't write. */
const TAINT_SOURCES = new Set([
    "gmail_list_messages", "gmail_read_message",
    "google_drive_list_files", "google_drive_read_file",
    "google_calendar_list_events",
    "web_search", "fetch_url", "http_request",
    "browser_open", "browser_click", "browser_type", "browser_extract_text", "browser_screenshot", "browser_list_pages",
    "youtube_search", "youtube_list_subscriptions",
    "device_read_screen", "device_get_clipboard", "device_run_command",
]);

/** Memory tools only taint when they return an entry stored as untrusted. */
const MEMORY_READERS = new Set(["recall", "list_memories"]);

const DEFAULT_TAINTED_RUN_TOOLS = [
    "get_time", "calculate", "convert_units", "generate_uuid", "list_events", "list_scheduled_tasks", "recall",
];

function envInt(name: string, fallback: number, min = 0): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

/** JARVIS_PROVENANCE_GUARDS=0 disables the guardrails (taint is still tracked and logged). */
export function guardsEnabled(): boolean {
    return process.env.JARVIS_PROVENANCE_GUARDS !== "0";
}

export function createProvenance(sources: string[] = []): ProvenanceState {
    return { tainted: sources.length > 0, sources: new Set(sources) };
}

export function snapshotProvenance(state: ProvenanceState | undefined): Provenance {
    return { tainted: !!state?.tainted, sources: state ? Array.from(state.sources) : [] };
}

export function originOf(provenance: Provenance | undefined): Origin {
    return provenance?.tainted ? "external" : "user";
}

/** True when the given tool result puts external content into the model's context. */
export function isTaintingResult(name: string, result: ToolResult): boolean {
    if (!result.success) return false;
    if (TAINT_SOURCES.has(name)) return true;
    if (MEMORY_READERS.has(name)) return containsUntrusted(result.data);
    return false;
}

function containsUntrusted(value: unknown, depth = 0): boolean {
    if (depth > 4 || !value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(v => containsUntrusted(v, depth + 1));
    const record = value as Record<string, unknown>;
    if (record.untrusted === true) return true;
    return Object.values(record).some(v => containsUntrusted(v, depth + 1));
}

/** Updates taint after a tool result. Returns true if this result newly tainted the conversation. */
export function noteToolResult(state: ProvenanceState, name: string, result: ToolResult, conversationId?: string): boolean {
    if (!isTaintingResult(name, result)) return false;
    const wasTainted = state.tainted;
    state.tainted = true;
    state.sources.add(name);
    if (!wasTainted) Log.info("Conversation ingested external content", { conversationId, source: name });
    return !wasTainted;
}

export function taintedTaskLimits(): { maxTasks: number; minIntervalMs: number } {
    return {
        maxTasks: envInt("JARVIS_TAINTED_TASK_MAX", 3),
        minIntervalMs: envInt("JARVIS_TAINTED_TASK_MIN_INTERVAL_MIN", 60, 1) * 60000,
    };
}

export function taintedSubagentMax(): number {
    return envInt("JARVIS_TAINTED_SUBAGENT_MAX", 1);
}

/** Tools available to scheduled/delegated runs created from tainted context. */
export function taintedRunTools(): Set<string> {
    const raw = process.env.JARVIS_TAINTED_RUN_TOOLS;
    const list = raw && raw.trim() ? raw.split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_TAINTED_RUN_TOOLS;
    return new Set(list);
}

export function logGuard(action: string, meta: Record<string, unknown>): void {
    Log.warn(`Provenance guard: ${action}`, meta);
}
