import { google } from "googleapis";
import { getGoogleClient } from "../../agent/Google/googleAuth";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const MAX_CONTENT_CHARS = 20000;
const EXPORTABLE_MIME: Record<string, string> = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
};

const driveListFiles: ToolSpec = {
    name: "google_drive_list_files",
    description: "Search and list files in the user's Google Drive.",
    category: "file",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "Substring to match against file names. Omit to list the most recently modified files." },
            maxResults: { type: "number", description: "Max files to return (default 20, max 50)", default: 20 },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const maxResults = Math.max(1, Math.min(50, Number(params.maxResults ?? 20)));
        const query = typeof params.query === "string" ? params.query.trim() : "";
        try {
            const auth = await getGoogleClient();
            const drive = google.drive({ version: "v3", auth });
            const list = await drive.files.list({
                q: query ? `name contains '${query.replace(/'/g, "\\'")}' and trashed = false` : "trashed = false",
                pageSize: maxResults,
                orderBy: "modifiedTime desc",
                fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
            });
            return { success: true, data: list.data.files ?? [] };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const driveReadFile: ToolSpec = {
    name: "google_drive_read_file",
    description: "Read the text content of a Google Drive file by id (Google Docs/Sheets/Slides are auto-exported to plain text/CSV; other text files are read directly).",
    category: "file",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            id: { type: "string", description: "Drive file id from google_drive_list_files" },
        },
        required: ["id"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const id = typeof params.id === "string" ? params.id : "";
        if (!id) return { success: false, data: null, error: "id is required" };
        try {
            const auth = await getGoogleClient();
            const drive = google.drive({ version: "v3", auth });
            const meta = await drive.files.get({ fileId: id, fields: "name,mimeType" });
            const mimeType = meta.data.mimeType || "";
            const exportMime = EXPORTABLE_MIME[mimeType];
            const response = exportMime
                ? await drive.files.export({ fileId: id, mimeType: exportMime }, { responseType: "text" })
                : await drive.files.get({ fileId: id, alt: "media" }, { responseType: "text" });
            const content = String(response.data).slice(0, MAX_CONTENT_CHARS);
            return { success: true, data: { id, name: meta.data.name, mimeType, content } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const driveUploadFile: ToolSpec = {
    name: "google_drive_upload_file",
    description: "Create a new text file in the user's Google Drive with the given content. Requires user approval.",
    category: "file",
    requiresApproval: true,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            name: { type: "string", description: "File name, e.g. 'notes.txt'" },
            content: { type: "string", description: "Text content of the file" },
        },
        required: ["name", "content"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const name = typeof params.name === "string" ? params.name.trim() : "";
        const content = typeof params.content === "string" ? params.content : "";
        if (!name) return { success: false, data: null, error: "name is required" };
        try {
            const auth = await getGoogleClient();
            const drive = google.drive({ version: "v3", auth });
            const created = await drive.files.create({
                requestBody: { name },
                media: { mimeType: "text/plain", body: content },
                fields: "id,webViewLink",
            });
            return { success: true, data: { id: created.data.id, webViewLink: created.data.webViewLink } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const driveTools: ToolSpec[] = [driveListFiles, driveReadFile, driveUploadFile];
export default driveTools;
