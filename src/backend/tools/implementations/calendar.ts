import { addEvent, listEvents, removeEvent } from "../../agent/Calendar/calendarStore";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

function serializeEvent(e: { id: string; title: string; description: string | null; location: string | null; startAt: number; endAt: number | null }) {
    return {
        id: e.id,
        title: e.title,
        description: e.description,
        location: e.location,
        start: new Date(e.startAt).toISOString(),
        end: e.endAt ? new Date(e.endAt).toISOString() : null,
    };
}

const createEvent: ToolSpec = {
    name: "create_event",
    description: "Add an event or appointment to Jarvis's calendar, for the user to review or ask about later (use schedule_task instead if Jarvis itself needs to proactively act or speak at that time).",
    category: "schedule",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            title: { type: "string", description: "Event title, e.g. 'Dentist appointment'" },
            start: { type: "string", description: "Absolute ISO 8601 start datetime, e.g. 2026-10-10T15:00:00" },
            end: { type: "string", description: "Absolute ISO 8601 end datetime (optional)" },
            location: { type: "string", description: "Location (optional)" },
            description: { type: "string", description: "Additional notes (optional)" },
        },
        required: ["title", "start"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const title = typeof params.title === "string" ? params.title.trim() : "";
        if (!title) return { success: false, data: null, error: "title is required" };
        const startAt = Date.parse(typeof params.start === "string" ? params.start : "");
        if (Number.isNaN(startAt)) return { success: false, data: null, error: "A valid 'start' datetime is required" };
        let endAt: number | null = null;
        if (typeof params.end === "string" && params.end.trim()) {
            endAt = Date.parse(params.end);
            if (Number.isNaN(endAt)) return { success: false, data: null, error: `Invalid 'end' datetime: ${params.end}` };
        }
        const event = addEvent(title, startAt, {
            endAt,
            location: typeof params.location === "string" ? params.location : null,
            description: typeof params.description === "string" ? params.description : null,
        });
        return { success: true, data: serializeEvent(event) };
    },
};

const listEventsTool: ToolSpec = {
    name: "list_events",
    description: "List calendar events in a date range. Defaults to the next 7 days if no range is given.",
    category: "schedule",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            from: { type: "string", description: "Start of range, ISO 8601 (default: now)" },
            to: { type: "string", description: "End of range, ISO 8601 (default: 7 days from now)" },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const now = Date.now();
        let fromMs = now;
        let toMs = now + 7 * 24 * 60 * 60 * 1000;
        if (typeof params.from === "string" && params.from.trim()) {
            const parsed = Date.parse(params.from);
            if (Number.isNaN(parsed)) return { success: false, data: null, error: `Invalid 'from' datetime: ${params.from}` };
            fromMs = parsed;
        }
        if (typeof params.to === "string" && params.to.trim()) {
            const parsed = Date.parse(params.to);
            if (Number.isNaN(parsed)) return { success: false, data: null, error: `Invalid 'to' datetime: ${params.to}` };
            toMs = parsed;
        }
        return { success: true, data: listEvents(fromMs, toMs).map(serializeEvent) };
    },
};

const deleteEvent: ToolSpec = {
    name: "delete_event",
    description: "Remove a calendar event by id (see list_events for ids).",
    category: "schedule",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            id: { type: "string", description: "Event id from list_events" },
        },
        required: ["id"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const id = typeof params.id === "string" ? params.id : "";
        if (!id) return { success: false, data: null, error: "id is required" };
        const removed = removeEvent(id);
        return removed
            ? { success: true, data: { id, deleted: true } }
            : { success: false, data: null, error: `No event with id ${id}` };
    },
};

const calendarTools: ToolSpec[] = [createEvent, listEventsTool, deleteEvent];
export default calendarTools;
