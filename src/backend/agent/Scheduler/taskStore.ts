import { v4 as uuid } from "uuid";
import { join } from "path";
import { homedir } from "os";
import Log from "../../Log";
import { loadJsonStore, saveJsonAtomic } from "../../utils/jsonStore";

export interface ScheduledTask {
    id: string;
    instructions: string;
    dueAt: number;
    recurringEveryMs: number | null;
    createdAt: number;
    lastRunAt: number | null;
    /** "external" when created from a conversation that had ingested external content (sec M2). */
    origin?: "user" | "external";
    originSources?: string[];
    /** Tasks with an expiry are removed once it passes. */
    expiresAt?: number | null;
}

export interface TaskOriginMeta {
    origin: "user" | "external";
    originSources?: string[];
    expiresAt?: number | null;
}

interface TaskFile {
    tasks: ScheduledTask[];
}

const MAX_TASKS = 200;

function storePath(): string {
    const root = process.env.JARVIS_DATA_DIR || join(homedir(), ".local", "share", "jarvis");
    return join(root, "tasks.json");
}

function load(): TaskFile {
    return loadJsonStore(storePath(), "tasks", "scheduled tasks") as unknown as TaskFile;
}

function save(data: TaskFile): void {
    saveJsonAtomic(storePath(), data);
}

export function listTasks(): ScheduledTask[] {
    return load().tasks.sort((a, b) => a.dueAt - b.dueAt);
}

/** Due tasks; expired tasks are removed (and logged) instead of being returned. */
export function listDueTasks(now: number = Date.now()): ScheduledTask[] {
    const data = load();
    const expired = data.tasks.filter(t => t.expiresAt && t.expiresAt <= now);
    if (expired.length > 0) {
        data.tasks = data.tasks.filter(t => !expired.includes(t));
        save(data);
        for (const t of expired) Log.warn("Provenance guard: scheduled task expired", { taskId: t.id, origin: t.origin, sources: t.originSources });
    }
    return data.tasks.filter(t => t.dueAt <= now);
}

export function addTask(instructions: string, dueAt: number, recurringEveryMs: number | null = null, meta?: TaskOriginMeta): ScheduledTask {
    const data = load();
    if (data.tasks.length >= MAX_TASKS) {
        // Previously the new task was silently dropped while reported as created.
        throw new Error(`Too many scheduled tasks (max ${MAX_TASKS}). Cancel one before adding another.`);
    }
    const task: ScheduledTask = {
        id: uuid(),
        instructions,
        dueAt,
        recurringEveryMs,
        createdAt: Date.now(),
        lastRunAt: null,
        ...(meta ? { origin: meta.origin, originSources: meta.originSources ?? [], expiresAt: meta.expiresAt ?? null } : {}),
    };
    data.tasks.push(task);
    save(data);
    return task;
}

export function removeTask(id: string): boolean {
    const data = load();
    const before = data.tasks.length;
    data.tasks = data.tasks.filter(t => t.id !== id);
    if (data.tasks.length === before) return false;
    save(data);
    return true;
}

export function markRan(id: string): void {
    const data = load();
    const task = data.tasks.find(t => t.id === id);
    if (!task) return;
    if (task.recurringEveryMs && task.recurringEveryMs > 0) {
        task.lastRunAt = Date.now();
        task.dueAt = Date.now() + task.recurringEveryMs;
        if (task.expiresAt && task.dueAt > task.expiresAt) {
            data.tasks = data.tasks.filter(t => t.id !== id);
            Log.warn("Provenance guard: recurring task reached its expiry", { taskId: id, origin: task.origin });
        }
    } else {
        data.tasks = data.tasks.filter(t => t.id !== id);
    }
    save(data);
}
