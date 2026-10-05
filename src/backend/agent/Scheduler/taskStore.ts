import { v4 as uuid } from "uuid";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import Log from "../../Log";

export interface ScheduledTask {
    id: string;
    instructions: string;
    dueAt: number;
    recurringEveryMs: number | null;
    createdAt: number;
    lastRunAt: number | null;
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
    const path = storePath();
    try {
        if (!existsSync(path)) return { tasks: [] };
        return JSON.parse(readFileSync(path, "utf-8")) as TaskFile;
    } catch (err: any) {
        Log.warn("Failed to load scheduled tasks, starting fresh", { error: err.message });
        return { tasks: [] };
    }
}

function save(data: TaskFile): void {
    const path = storePath();
    mkdirSync(path.substring(0, path.lastIndexOf("/")) || ".", { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
}

export function listTasks(): ScheduledTask[] {
    return load().tasks.sort((a, b) => a.dueAt - b.dueAt);
}

export function listDueTasks(now: number = Date.now()): ScheduledTask[] {
    return load().tasks.filter(t => t.dueAt <= now);
}

export function addTask(instructions: string, dueAt: number, recurringEveryMs: number | null = null): ScheduledTask {
    const data = load();
    const task: ScheduledTask = {
        id: uuid(),
        instructions,
        dueAt,
        recurringEveryMs,
        createdAt: Date.now(),
        lastRunAt: null,
    };
    data.tasks.push(task);
    if (data.tasks.length > MAX_TASKS) {
        data.tasks = data.tasks.sort((a, b) => a.dueAt - b.dueAt).slice(0, MAX_TASKS);
    }
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
