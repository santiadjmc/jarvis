import { google } from "googleapis";
import { getGoogleClient } from "../../agent/Google/googleAuth";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

function decodeBase64Url(data: string): string {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function extractPlainText(payload: any): string {
    if (!payload) return "";
    if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBase64Url(payload.body.data);
    if (Array.isArray(payload.parts)) {
        for (const part of payload.parts) {
            const text = extractPlainText(part);
            if (text) return text;
        }
    }
    if (payload.body?.data) return decodeBase64Url(payload.body.data);
    return "";
}

function headerValue(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string): string {
    return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function sanitizeHeader(value: string): string {
    return value.replace(/[\r\n]+/g, " ").trim();
}

const gmailListMessages: ToolSpec = {
    name: "gmail_list_messages",
    description: "List recent Gmail messages, optionally filtered by a Gmail search query (e.g. 'is:unread', 'from:boss@company.com', 'subject:invoice').",
    category: "communication",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "Gmail search query (same syntax as the Gmail search box). Omit to list the most recent messages." },
            maxResults: { type: "number", description: "Max messages to return (default 10, max 50)", default: 10 },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const maxResults = Math.max(1, Math.min(50, Number(params.maxResults ?? 10)));
        const query = typeof params.query === "string" ? params.query : undefined;
        try {
            const auth = await getGoogleClient();
            const gmail = google.gmail({ version: "v1", auth });
            const list = await gmail.users.messages.list({ userId: "me", maxResults, q: query });
            const ids = list.data.messages ?? [];
            const messages = await Promise.all(ids.map(async (m) => {
                const full = await gmail.users.messages.get({ userId: "me", id: m.id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
                return {
                    id: m.id,
                    from: headerValue(full.data.payload?.headers, "From"),
                    subject: headerValue(full.data.payload?.headers, "Subject"),
                    date: headerValue(full.data.payload?.headers, "Date"),
                    snippet: full.data.snippet,
                    unread: full.data.labelIds?.includes("UNREAD") ?? false,
                };
            }));
            return { success: true, data: { query: query ?? null, messages } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const gmailReadMessage: ToolSpec = {
    name: "gmail_read_message",
    description: "Read the full content of a Gmail message by id (see gmail_list_messages for ids).",
    category: "communication",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            id: { type: "string", description: "Gmail message id" },
        },
        required: ["id"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const id = typeof params.id === "string" ? params.id : "";
        if (!id) return { success: false, data: null, error: "id is required" };
        try {
            const auth = await getGoogleClient();
            const gmail = google.gmail({ version: "v1", auth });
            const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
            const body = extractPlainText(full.data.payload).slice(0, 8000);
            return {
                success: true,
                data: {
                    id,
                    from: headerValue(full.data.payload?.headers, "From"),
                    to: headerValue(full.data.payload?.headers, "To"),
                    subject: headerValue(full.data.payload?.headers, "Subject"),
                    date: headerValue(full.data.payload?.headers, "Date"),
                    body,
                },
            };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const gmailSend: ToolSpec = {
    name: "gmail_send",
    description: "Send an email from the user's connected Gmail account. Requires user approval.",
    category: "communication",
    requiresApproval: true,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Plain-text email body" },
        },
        required: ["to", "subject", "body"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const to = typeof params.to === "string" ? params.to.trim() : "";
        const subject = sanitizeHeader(typeof params.subject === "string" ? params.subject : "");
        const body = typeof params.body === "string" ? params.body : "";
        if (!to) return { success: false, data: null, error: "to is required" };
        if (/[\r\n]/.test(to) || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) {
            return { success: false, data: null, error: "to must be a single valid email address" };
        }
        try {
            const auth = await getGoogleClient();
            const gmail = google.gmail({ version: "v1", auth });
            const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`)
                .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
            const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
            return { success: true, data: { to, subject, id: sent.data.id } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const gmailTools: ToolSpec[] = [gmailListMessages, gmailReadMessage, gmailSend];
export default gmailTools;
