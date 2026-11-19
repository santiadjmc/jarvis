import { v4 as uuid } from "uuid";
import puppeteer, { type Browser, type Page } from "puppeteer";
import Log from "../../Log";
import { allowPrivateNetworks, assertPublicHost, assertPublicUrl } from "../../utils/netguard";

const MAX_PAGES = 5;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const NAV_TIMEOUT_MS = 30000;

interface TrackedPage {
    page: Page;
    lastUsedAt: number;
}

let browserPromise: Promise<Browser> | null = null;
const pages = new Map<string, TrackedPage>();
let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanupTimer(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [id, tracked] of pages) {
            if (now - tracked.lastUsedAt > IDLE_TIMEOUT_MS) {
                tracked.page.close().catch(() => {});
                pages.delete(id);
                Log.info("Closed idle browser page", { pageId: id });
            }
        }
    }, 60000);
}

async function getBrowser(): Promise<Browser> {
    const current = browserPromise;
    if (current) {
        try {
            const browser = await current;
            if (browser.connected) return browser;
        } catch {}
        // Another caller already started a relaunch while we were waiting.
        if (browserPromise !== current) return getBrowser();
    }
    // Assigned synchronously so concurrent callers share one launch.
    const launching: Promise<Browser> = puppeteer.launch({
        headless: true,
        args: launchArgs(),
    }).then((browser) => {
        browser.on("disconnected", () => {
            if (browserPromise === launching) browserPromise = null;
            if (pages.size > 0) Log.warn("Headless browser disconnected; dropping its pages", { pages: pages.size });
            pages.clear();
        });
        return browser;
    });
    browserPromise = launching;
    launching.catch(() => {
        if (browserPromise === launching) browserPromise = null;
    });
    return launching;
}

export async function closeBrowser(): Promise<void> {
    const current = browserPromise;
    browserPromise = null;
    pages.clear();
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
    if (!current) return;
    try {
        const browser = await current;
        await browser.close();
    } catch {}
}

/**
 * Chromium's sandbox stays on unless we run as root (Chrome refuses to start
 * as root with it enabled) or JARVIS_BROWSER_NO_SANDBOX=1 is set for hosts
 * without user namespaces. Running Jarvis as a non-root user is recommended.
 */
function launchArgs(): string[] {
    const args = ["--disable-dev-shm-usage"];
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (isRoot || process.env.JARVIS_BROWSER_NO_SANDBOX === "1") {
        Log.warn("Launching headless browser without the Chromium sandbox", {
            reason: isRoot ? "running as root" : "JARVIS_BROWSER_NO_SANDBOX=1",
        });
        args.push("--no-sandbox", "--disable-setuid-sandbox");
    }
    return args;
}

/** Returns an error message when a browser request must be blocked, else null. */
export async function checkBrowserRequestUrl(raw: string): Promise<string | null> {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return "invalid URL";
    }
    if (url.protocol === "data:" || url.protocol === "blob:" || url.href === "about:blank") return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return `scheme ${url.protocol} is not allowed`;
    if (allowPrivateNetworks()) return null;
    try {
        await assertPublicHost(url.hostname);
        return null;
    } catch (err: any) {
        return err.message;
    }
}

/**
 * Every request the page makes (navigations, redirects, subresources, fetch/XHR)
 * is re-checked against netguard, not just the first URL. Residual risk: Chromium
 * resolves DNS itself after our check, so a sub-second DNS rebind is not fully
 * excluded; an egress proxy would be needed for that.
 */
export async function guardPage(page: Page): Promise<void> {
    await page.setRequestInterception(true);
    page.on("request", (request) => {
        if (request.isInterceptResolutionHandled()) return;
        checkBrowserRequestUrl(request.url()).then((blocked) => {
            if (request.isInterceptResolutionHandled()) return;
            if (blocked) {
                Log.warn("Blocked browser request", { url: request.url().slice(0, 200), reason: blocked });
                return request.abort("blockedbyclient");
            }
            return request.continue();
        }).catch(() => {});
    });
}

export async function openPage(url: string, existingPageId?: string): Promise<{ pageId: string; title: string; text: string }> {
    ensureCleanupTimer();
    // Validate before allocating a page so a rejected URL can't leak a tracked page.
    const target = await assertPublicUrl(url);
    let page: Page;
    let pageId: string;
    let created = false;

    if (existingPageId && pages.has(existingPageId)) {
        pageId = existingPageId;
        page = pages.get(existingPageId)!.page;
    } else {
        if (pages.size >= MAX_PAGES) {
            throw new Error(`Too many open browser pages (max ${MAX_PAGES}). Close one with browser_close first.`);
        }
        const browser = await getBrowser();
        page = await browser.newPage();
        pageId = uuid();
        created = true;
        pages.set(pageId, { page, lastUsedAt: Date.now() });
        try {
            await guardPage(page);
        } catch (err) {
            pages.delete(pageId);
            await page.close().catch(() => {});
            throw err;
        }
    }

    try {
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    } catch (err) {
        if (created) {
            pages.delete(pageId);
            await page.close().catch(() => {});
        }
        throw err;
    }
    pages.get(pageId)!.lastUsedAt = Date.now();
    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? "");
    return { pageId, title, text };
}

export function getPage(pageId: string): Page {
    const tracked = pages.get(pageId);
    if (!tracked) throw new Error(`No open browser page with id ${pageId}. Use browser_open first.`);
    tracked.lastUsedAt = Date.now();
    return tracked.page;
}

export async function closePage(pageId: string): Promise<boolean> {
    const tracked = pages.get(pageId);
    if (!tracked) return false;
    await tracked.page.close().catch(() => {});
    pages.delete(pageId);
    return true;
}

export function listPageIds(): string[] {
    return Array.from(pages.keys());
}
