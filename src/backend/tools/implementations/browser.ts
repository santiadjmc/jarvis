import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { openPage, getPage, closePage, listPageIds } from "../../agent/Browser/browserSession";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const ACTION_TIMEOUT_MS = 15000;

function screenshotDir(): string {
    return join(process.env.JARVIS_DATA_DIR || join(homedir(), ".local", "share", "jarvis"), "screenshots");
}

function describeLaunchError(err: any): string {
    const message = String(err?.message || err);
    if (/Failed to launch|spawn.*ENOENT|libnss3|shared libraries/i.test(message)) {
        return "Could not launch the headless browser on this server (missing Chrome dependencies). See https://pptr.dev/troubleshooting for the required system libraries.";
    }
    return message;
}

const browserOpen: ToolSpec = {
    name: "browser_open",
    description: "Open a URL in a real headless browser (renders JavaScript, unlike fetch_url) and return the page title and visible text. Returns a pageId to reuse for browser_click, browser_type, browser_extract_text, and browser_screenshot on the same page.",
    category: "web",
    requiresApproval: false,
    timeoutMs: 35000,
    parameters: {
        type: "object",
        properties: {
            url: { type: "string", description: "Absolute http(s) URL to open" },
            pageId: { type: "string", description: "Reuse an existing open page instead of opening a new one (navigates it to this URL)" },
        },
        required: ["url"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const url = typeof params.url === "string" ? params.url : "";
        if (!/^https?:\/\//i.test(url)) return { success: false, data: null, error: "Only http(s) URLs are supported" };
        try {
            const result = await openPage(url, typeof params.pageId === "string" ? params.pageId : undefined);
            return { success: true, data: result };
        } catch (err: any) {
            return { success: false, data: null, error: describeLaunchError(err) };
        }
    },
};

const browserClick: ToolSpec = {
    name: "browser_click",
    description: "Click an element on an open browser page by CSS selector. Requires user approval since it can trigger side effects (submitting forms, navigating, purchases).",
    category: "web",
    requiresApproval: true,
    timeoutMs: ACTION_TIMEOUT_MS + 5000,
    parameters: {
        type: "object",
        properties: {
            pageId: { type: "string", description: "Page id from browser_open" },
            selector: { type: "string", description: "CSS selector of the element to click, e.g. 'button#submit' or 'a.nav-link'" },
        },
        required: ["pageId", "selector"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const pageId = typeof params.pageId === "string" ? params.pageId : "";
        const selector = typeof params.selector === "string" ? params.selector : "";
        if (!pageId || !selector) return { success: false, data: null, error: "pageId and selector are required" };
        try {
            const page = getPage(pageId);
            await page.locator(selector).setTimeout(ACTION_TIMEOUT_MS).click();
            await new Promise(r => setTimeout(r, 300));
            const title = await page.title();
            return { success: true, data: { pageId, clicked: selector, title } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const browserType: ToolSpec = {
    name: "browser_type",
    description: "Type text into an input field on an open browser page. Requires user approval since it can be used to fill and submit forms.",
    category: "web",
    requiresApproval: true,
    timeoutMs: ACTION_TIMEOUT_MS + 5000,
    parameters: {
        type: "object",
        properties: {
            pageId: { type: "string", description: "Page id from browser_open" },
            selector: { type: "string", description: "CSS selector of the input element, e.g. 'input[name=q]'" },
            text: { type: "string", description: "Text to type into the field" },
            pressEnter: { type: "boolean", description: "Press Enter after typing (default false)", default: false },
        },
        required: ["pageId", "selector", "text"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const pageId = typeof params.pageId === "string" ? params.pageId : "";
        const selector = typeof params.selector === "string" ? params.selector : "";
        const text = typeof params.text === "string" ? params.text : "";
        if (!pageId || !selector) return { success: false, data: null, error: "pageId and selector are required" };
        try {
            const page = getPage(pageId);
            await page.locator(selector).setTimeout(ACTION_TIMEOUT_MS).fill(text);
            if (params.pressEnter === true) {
                await page.keyboard.press("Enter");
                await new Promise(r => setTimeout(r, 300));
            }
            return { success: true, data: { pageId, filled: selector } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const browserExtractText: ToolSpec = {
    name: "browser_extract_text",
    description: "Get the visible text of an open browser page, or of a specific element by CSS selector.",
    category: "web",
    requiresApproval: false,
    timeoutMs: ACTION_TIMEOUT_MS,
    parameters: {
        type: "object",
        properties: {
            pageId: { type: "string", description: "Page id from browser_open" },
            selector: { type: "string", description: "CSS selector to extract text from (defaults to the whole page body)" },
        },
        required: ["pageId"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const pageId = typeof params.pageId === "string" ? params.pageId : "";
        if (!pageId) return { success: false, data: null, error: "pageId is required" };
        const selector = typeof params.selector === "string" && params.selector ? params.selector : null;
        try {
            const page = getPage(pageId);
            const text = await page.evaluate((sel: string | null) => {
                const el = sel ? document.querySelector(sel) : document.body;
                return (el as HTMLElement | null)?.innerText?.slice(0, 8000) ?? "";
            }, selector);
            return { success: true, data: { pageId, selector, text } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const browserScreenshot: ToolSpec = {
    name: "browser_screenshot",
    description: "Take a screenshot of an open browser page and save it to disk, returning the file path.",
    category: "web",
    requiresApproval: false,
    timeoutMs: ACTION_TIMEOUT_MS + 5000,
    parameters: {
        type: "object",
        properties: {
            pageId: { type: "string", description: "Page id from browser_open" },
            fullPage: { type: "boolean", description: "Capture the full scrollable page instead of just the viewport (default false)", default: false },
        },
        required: ["pageId"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const pageId = typeof params.pageId === "string" ? params.pageId : "";
        if (!pageId) return { success: false, data: null, error: "pageId is required" };
        try {
            const page = getPage(pageId);
            const buffer = await page.screenshot({ fullPage: params.fullPage === true, type: "png" });
            const dir = screenshotDir();
            await mkdir(dir, { recursive: true });
            const path = join(dir, `${randomUUID()}.png`);
            await writeFile(path, buffer);
            return { success: true, data: { pageId, path, bytes: buffer.length } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const browserClose: ToolSpec = {
    name: "browser_close",
    description: "Close an open browser page to free resources.",
    category: "web",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            pageId: { type: "string", description: "Page id from browser_open" },
        },
        required: ["pageId"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const pageId = typeof params.pageId === "string" ? params.pageId : "";
        if (!pageId) return { success: false, data: null, error: "pageId is required" };
        const closed = await closePage(pageId);
        return closed
            ? { success: true, data: { pageId, closed: true } }
            : { success: false, data: null, error: `No open page with id ${pageId}` };
    },
};

const browserListPages: ToolSpec = {
    name: "browser_list_pages",
    description: "List currently open browser page ids.",
    category: "web",
    requiresApproval: false,
    timeoutMs: 5000,
    parameters: { type: "object", properties: {} },
    async execute(_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        return { success: true, data: { pageIds: listPageIds() } };
    },
};

const browserTools: ToolSpec[] = [
    browserOpen,
    browserClick,
    browserType,
    browserExtractText,
    browserScreenshot,
    browserClose,
    browserListPages,
];
export default browserTools;
