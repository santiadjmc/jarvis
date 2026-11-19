import { v4 as uuid } from "uuid";
import { join } from "path";
import { homedir } from "os";
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
}

export interface TaskOriginMeta {
    origin: "user" | "external";
    originSources?: string[];
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

export function listDueTasks(now: number = Date.now()): ScheduledTask[] {
    return load().tasks.filter(t => t.dueAt <= now);
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
        ...(meta ? { origin: meta.origin, originSources: meta.originSources ?? [] } : {}),
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
    } else {
        data.tasks = data.tasks.filter(t => t.id !== id);
    }
    save(data);
}
