import { v4 as uuid } from "uuid";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import Log from "../../Log";

export interface CalendarEvent {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    startAt: number;
    endAt: number | null;
    createdAt: number;
}

interface CalendarFile {
    events: CalendarEvent[];
}

const MAX_EVENTS = 1000;

function storePath(): string {
    const root = process.env.JARVIS_DATA_DIR || join(homedir(), ".local", "share", "jarvis");
    return join(root, "calendar.json");
}

function load(): CalendarFile {
    const path = storePath();
    try {
        if (!existsSync(path)) return { events: [] };
        return JSON.parse(readFileSync(path, "utf-8")) as CalendarFile;
    } catch (err: any) {
        Log.warn("Failed to load calendar, starting fresh", { error: err.message });
        return { events: [] };
    }
}

function save(data: CalendarFile): void {
    const path = storePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
}

export function addEvent(title: string, startAt: number, opts: { endAt?: number | null; location?: string | null; description?: string | null } = {}): CalendarEvent {
    const data = load();
    const event: CalendarEvent = {
        id: uuid(),
        title,
        description: opts.description ?? null,
        location: opts.location ?? null,
        startAt,
        endAt: opts.endAt ?? null,
        createdAt: Date.now(),
    };
    data.events.push(event);
    if (data.events.length > MAX_EVENTS) {
        data.events = data.events.sort((a, b) => a.startAt - b.startAt).slice(-MAX_EVENTS);
    }
    save(data);
    return event;
}

export function listEvents(fromMs: number, toMs: number): CalendarEvent[] {
    return load().events
        .filter(e => e.startAt >= fromMs && e.startAt <= toMs)
        .sort((a, b) => a.startAt - b.startAt);
}

export function removeEvent(id: string): boolean {
    const data = load();
    const before = data.events.length;
    data.events = data.events.filter(e => e.id !== id);
    if (data.events.length === before) return false;
    save(data);
    return true;
}
