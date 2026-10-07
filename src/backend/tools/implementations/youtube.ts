import { google } from "googleapis";
import { getGoogleClient } from "../../agent/Google/googleAuth";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const youtubeSearch: ToolSpec = {
    name: "youtube_search",
    description: "Search YouTube for videos and return titles, channels, and links.",
    category: "web",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query" },
            maxResults: { type: "number", description: "Max results (default 8, max 25)", default: 8 },
        },
        required: ["query"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (!query) return { success: false, data: null, error: "query is required" };
        const maxResults = Math.max(1, Math.min(25, Number(params.maxResults ?? 8)));
        try {
            const auth = await getGoogleClient();
            const youtube = google.youtube({ version: "v3", auth });
            const search = await youtube.search.list({ part: ["snippet"], q: query, maxResults, type: ["video"] });
            const results = (search.data.items ?? []).map(item => ({
                videoId: item.id?.videoId,
                title: item.snippet?.title,
                channel: item.snippet?.channelTitle,
                publishedAt: item.snippet?.publishedAt,
                url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : null,
            }));
            return { success: true, data: results };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const youtubeListSubscriptions: ToolSpec = {
    name: "youtube_list_subscriptions",
    description: "List channels the user is subscribed to on YouTube.",
    category: "web",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            maxResults: { type: "number", description: "Max channels to return (default 25, max 50)", default: 25 },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const maxResults = Math.max(1, Math.min(50, Number(params.maxResults ?? 25)));
        try {
            const auth = await getGoogleClient();
            const youtube = google.youtube({ version: "v3", auth });
            const subs = await youtube.subscriptions.list({ part: ["snippet"], mine: true, maxResults });
            const channels = (subs.data.items ?? []).map(item => ({
                channelId: item.snippet?.resourceId?.channelId,
                title: item.snippet?.title,
                description: item.snippet?.description,
            }));
            return { success: true, data: channels };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const youtubeTools: ToolSpec[] = [youtubeSearch, youtubeListSubscriptions];
export default youtubeTools;
