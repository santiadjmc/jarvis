import { google } from "googleapis";
import { getGoogleClient } from "../../agent/Google/googleAuth";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const googleCalendarListEvents: ToolSpec = {
    name: "google_calendar_list_events",
    description: "List events from the user's real Google Calendar in a date range. Defaults to the next 7 days.",
    category: "schedule",
    requiresApproval: false,
    timeoutMs: 20000,
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
        try {
            const auth = await getGoogleClient();
            const calendar = google.calendar({ version: "v3", auth });
            const list = await calendar.events.list({
                calendarId: "primary",
                timeMin: new Date(fromMs).toISOString(),
                timeMax: new Date(toMs).toISOString(),
                singleEvents: true,
                orderBy: "startTime",
                maxResults: 50,
            });
            const events = (list.data.items ?? []).map(e => ({
                id: e.id,
                title: e.summary || "(no title)",
                start: e.start?.dateTime || e.start?.date,
                end: e.end?.dateTime || e.end?.date,
                location: e.location || null,
                description: e.description || null,
            }));
            return { success: true, data: events };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const googleCalendarCreateEvent: ToolSpec = {
    name: "google_calendar_create_event",
    description: "Create an event on the user's real Google Calendar. Requires user approval.",
    category: "schedule",
    requiresApproval: true,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            title: { type: "string", description: "Event title" },
            start: { type: "string", description: "Absolute ISO 8601 start datetime" },
            end: { type: "string", description: "Absolute ISO 8601 end datetime (defaults to 1 hour after start)" },
            location: { type: "string", description: "Location (optional)" },
            description: { type: "string", description: "Notes (optional)" },
        },
        required: ["title", "start"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const title = typeof params.title === "string" ? params.title.trim() : "";
        if (!title) return { success: false, data: null, error: "title is required" };
        const startMs = Date.parse(typeof params.start === "string" ? params.start : "");
        if (Number.isNaN(startMs)) return { success: false, data: null, error: "A valid 'start' datetime is required" };
        let endMs = startMs + 3600000;
        if (typeof params.end === "string" && params.end.trim()) {
            const parsed = Date.parse(params.end);
            if (Number.isNaN(parsed)) return { success: false, data: null, error: `Invalid 'end' datetime: ${params.end}` };
            endMs = parsed;
        }
        try {
            const auth = await getGoogleClient();
            const calendar = google.calendar({ version: "v3", auth });
            const created = await calendar.events.insert({
                calendarId: "primary",
                requestBody: {
                    summary: title,
                    location: typeof params.location === "string" ? params.location : undefined,
                    description: typeof params.description === "string" ? params.description : undefined,
                    start: { dateTime: new Date(startMs).toISOString() },
                    end: { dateTime: new Date(endMs).toISOString() },
                },
            });
            return { success: true, data: { id: created.data.id, htmlLink: created.data.htmlLink } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const googleCalendarDeleteEvent: ToolSpec = {
    name: "google_calendar_delete_event",
    description: "Delete an event from the user's real Google Calendar by id. Requires user approval.",
    category: "schedule",
    requiresApproval: true,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            id: { type: "string", description: "Event id from google_calendar_list_events" },
        },
        required: ["id"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const id = typeof params.id === "string" ? params.id : "";
        if (!id) return { success: false, data: null, error: "id is required" };
        try {
            const auth = await getGoogleClient();
            const calendar = google.calendar({ version: "v3", auth });
            await calendar.events.delete({ calendarId: "primary", eventId: id });
            return { success: true, data: { id, deleted: true } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const googleCalendarTools: ToolSpec[] = [googleCalendarListEvents, googleCalendarCreateEvent, googleCalendarDeleteEvent];
export default googleCalendarTools;
