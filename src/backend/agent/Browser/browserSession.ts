import { v4 as uuid } from "uuid";
import puppeteer, { type Browser, type Page } from "puppeteer";
import Log from "../../Log";
import { assertPublicUrl } from "../../utils/netguard";

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
    if (browserPromise) {
        try {
            const browser = await browserPromise;
            if (browser.connected) return browser;
        } catch {}
    }
    browserPromise = puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    return browserPromise;
}

export async function openPage(url: string, existingPageId?: string): Promise<{ pageId: string; title: string; text: string }> {
    ensureCleanupTimer();
    let page: Page;
    let pageId: string;

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
        pages.set(pageId, { page, lastUsedAt: Date.now() });
    }

    const target = await assertPublicUrl(url);
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
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
