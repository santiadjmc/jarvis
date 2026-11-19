import { GOOGLE_CONNECT_HINT, status, isConfigured } from "../../agent/Google/googleAuth";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const googleAccountStatus: ToolSpec = {
    name: "google_account_status",
    description: `Check whether a Google account is connected for Gmail/Calendar/Drive/YouTube tools, and how soon the connection needs to be refreshed. If it isn't connected or is about to expire, tell the user how to (re)connect: ${GOOGLE_CONNECT_HINT}`,
    category: "system",
    requiresApproval: false,
    timeoutMs: 5000,
    parameters: { type: "object", properties: {} },
    async execute(_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        if (!isConfigured()) {
            return { success: true, data: { connected: false, configured: false, note: "Google OAuth is not configured on this server (missing GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI)." } };
        }
        const info = status();
        return { success: true, data: { configured: true, ...info, ...(info.connected ? {} : { howToConnect: GOOGLE_CONNECT_HINT }) } };
    },
};

const googleAccountTools: ToolSpec[] = [googleAccountStatus];
export default googleAccountTools;
