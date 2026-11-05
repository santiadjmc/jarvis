import { lookup as dnsLookup } from "dns";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { Agent } from "undici";

const MAX_REDIRECTS = 5;

export function allowPrivateNetworks(): boolean {
    return process.env.JARVIS_FETCH_ALLOW_PRIVATE === "1";
}

export function isPrivateAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) {
        const [a, b] = address.split(".").map(Number);
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 192 && b === 0) ||
            (a === 198 && (b === 18 || b === 19)) ||
            a >= 224
        );
    }
    if (family === 6) {
        const lower = address.toLowerCase();
        if (lower === "::" || lower === "::1") return true;
        if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice("::ffff:".length));
        return (
            lower.startsWith("fc") ||
            lower.startsWith("fd") ||
            lower.startsWith("fe8") ||
            lower.startsWith("fe9") ||
            lower.startsWith("fea") ||
            lower.startsWith("feb") ||
            lower.startsWith("ff")
        );
    }
    return true;
}

export async function assertPublicHost(host: string): Promise<void> {
    if (allowPrivateNetworks()) return;
    const clean = host.replace(/^\[|\]$/g, "");
    if (clean === "localhost" || clean.endsWith(".localhost")) {
        throw new Error("Refusing to target local addresses");
    }
    if (isIP(clean)) {
        if (isPrivateAddress(clean)) throw new Error("Refusing to target private or local addresses");
        return;
    }
    let addresses: Array<{ address: string; family: number }>;
    try {
        addresses = await lookup(clean, { all: true, verbatim: true });
    } catch {
        throw new Error(`Could not resolve host: ${clean}`);
    }
    if (addresses.length === 0) throw new Error(`Could not resolve host: ${clean}`);
    if (addresses.some(entry => isPrivateAddress(entry.address))) {
        throw new Error("Refusing to target private or local addresses");
    }
}

export async function assertPublicUrl(raw: string): Promise<URL> {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only http(s) URLs are supported");
    }
    if (allowPrivateNetworks()) return url;
    await assertPublicHost(url.hostname);
    return url;
}

function publicLookup(hostname: string, options: unknown, callback: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void): void {
    if (allowPrivateNetworks()) {
        dnsLookup(hostname, options as never, callback as never);
        return;
    }
    lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
        const allowed = addresses.filter(a => !isPrivateAddress(a.address));
        if (allowed.length === 0) {
            const err = new Error(`Refusing to connect to private or local address: ${hostname}`) as NodeJS.ErrnoException;
            err.code = "EPRIVATEADDR";
            callback(err);
            return;
        }
        if ((options as { all?: boolean })?.all) {
            callback(null, allowed);
        } else {
            callback(null, allowed[0].address, allowed[0].family);
        }
    }).catch((err) => callback(err as NodeJS.ErrnoException));
}

export const publicDispatcher = new Agent({
    connect: { lookup: publicLookup as never },
});

export interface GuardedFetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}

export async function guardedFetch(url: string, init: GuardedFetchInit = {}): Promise<Response> {
    let target = await assertPublicUrl(url);
    for (let redirects = 0; ; redirects++) {
        const response = await fetch(target, {
            method: init.method || "GET",
            headers: init.headers,
            body: init.body,
            signal: init.signal,
            redirect: "manual",
            dispatcher: publicDispatcher,
        } as RequestInit & { dispatcher: Agent });
        if (response.status < 300 || response.status >= 400) return response;
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) return response;
        if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
        target = await assertPublicUrl(new URL(location, target).toString());
    }
}
