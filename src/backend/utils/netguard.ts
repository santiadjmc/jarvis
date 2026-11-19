import { lookup as dnsLookup } from "dns";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { Agent, fetch as undiciFetch } from "undici";

const MAX_REDIRECTS = 5;

export function allowPrivateNetworks(): boolean {
    return process.env.JARVIS_FETCH_ALLOW_PRIVATE === "1";
}

function isPrivateIPv4(address: string): boolean {
    const [a, b, c] = address.split(".").map(Number);
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF special-purpose /24 and TEST-NET-1, not the rest of 192.0/16
        (a === 192 && b === 88 && c === 99) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        a >= 224
    );
}

/** Parses an IPv6 literal into 8 hextets (handles '::' and a dotted IPv4 tail). */
function parseIPv6(address: string): number[] | null {
    let text = address.toLowerCase();
    const zone = text.indexOf("%");
    if (zone !== -1) text = text.slice(0, zone);
    const lastColon = text.lastIndexOf(":");
    const v4 = text.slice(lastColon + 1);
    if (v4.includes(".")) {
        if (isIP(v4) !== 4) return null;
        const [a, b, c, d] = v4.split(".").map(Number);
        text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }
    const halves = text.split("::");
    if (halves.length > 2) return null;
    const parse = (part: string) => (part ? part.split(":").filter(p => p !== "").map(h => parseInt(h, 16)) : []);
    const head = parse(halves[0]);
    const rest = halves.length === 2 ? parse(halves[1]) : [];
    const fixed = head.length + rest.length;
    if (halves.length === 1 && fixed !== 8) return null;
    if (fixed > 8) return null;
    const zeros = new Array(8 - fixed).fill(0);
    const hextets = halves.length === 2 ? [...head, ...zeros, ...rest] : head;
    if (hextets.length !== 8 || hextets.some(h => !Number.isInteger(h) || h < 0 || h > 0xffff)) return null;
    return hextets;
}

function v4FromHextets(hi: number, lo: number): string {
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}

function isPrivateIPv6(address: string): boolean {
    const h = parseIPv6(address);
    if (!h) return true;
    const [h0, h1, h2, h3, h4, h5, h6, h7] = h;
    const first96Zero = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0;
    // ::, ::1 and the deprecated IPv4-compatible ::/96 range.
    if (first96Zero) return true;
    // IPv4-mapped ::ffff:0:0/96 and NAT64 64:ff9b::/96: judge the embedded IPv4.
    if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) return isPrivateIPv4(v4FromHextets(h6, h7));
    if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) return isPrivateIPv4(v4FromHextets(h6, h7));
    // Local-use NAT64 64:ff9b:1::/48.
    if (h0 === 0x64 && h1 === 0xff9b && h2 === 1) return true;
    // 6to4 2002::/16 carries an IPv4 address in bits 16-47.
    if (h0 === 0x2002) return isPrivateIPv4(v4FromHextets(h1, h2));
    // Teredo 2001::/32 and documentation 2001:db8::/32.
    if (h0 === 0x2001 && (h1 === 0 || h1 === 0xdb8)) return true;
    // Discard-only 100::/64.
    if (h0 === 0x100 && h1 === 0 && h2 === 0 && h3 === 0) return true;
    return (
        (h0 & 0xfe00) === 0xfc00 || // unique local fc00::/7
        (h0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
        (h0 & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
        (h0 & 0xff00) === 0xff00    // multicast ff00::/8
    );
}

export function isPrivateAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) return isPrivateIPv4(address);
    if (family === 6) return isPrivateIPv6(address);
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

/**
 * Resolves a host once and returns a validated IP literal, so callers can
 * connect to exactly the address that was checked (no DNS-rebinding TOCTOU).
 */
export async function resolvePublicAddress(host: string): Promise<string> {
    const clean = host.replace(/^\[|\]$/g, "");
    if (isIP(clean)) {
        await assertPublicHost(clean);
        return clean;
    }
    await assertPublicHost(clean);
    let addresses: Array<{ address: string; family: number }>;
    try {
        addresses = await lookup(clean, { all: true, verbatim: true });
    } catch {
        throw new Error(`Could not resolve host: ${clean}`);
    }
    const allowed = allowPrivateNetworks() ? addresses : addresses.filter(a => !isPrivateAddress(a.address));
    if (allowed.length === 0) throw new Error("Refusing to target private or local addresses");
    return allowed[0].address;
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

const CREDENTIAL_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-api-key", "api-key", "x-auth-token"]);
const BODY_HEADERS = new Set(["content-type", "content-length", "content-encoding", "content-language", "content-location"]);

export async function guardedFetch(url: string, init: GuardedFetchInit = {}): Promise<Response> {
    let target = await assertPublicUrl(url);
    let method = (init.method || "GET").toUpperCase();
    let body = init.body;
    let headers = init.headers ? { ...init.headers } : undefined;
    for (let redirects = 0; ; redirects++) {
        const response = (await undiciFetch(target, {
            method,
            headers,
            body,
            signal: init.signal,
            redirect: "manual",
            dispatcher: publicDispatcher,
        } as unknown as Parameters<typeof undiciFetch>[1])) as unknown as Response;
        if (response.status < 300 || response.status >= 400) return response;
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) return response;
        if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
        const next = await assertPublicUrl(new URL(location, target).toString());

        // Follow the fetch spec: never forward credentials to another origin, and
        // turn 303 (and 301/302 after POST) into a body-less GET.
        if (headers && next.origin !== target.origin) {
            headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.has(k.toLowerCase())));
        }
        if ((response.status === 303 && method !== "GET" && method !== "HEAD") ||
            ((response.status === 301 || response.status === 302) && method === "POST")) {
            method = "GET";
            body = undefined;
            if (headers) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !BODY_HEADERS.has(k.toLowerCase())));
        }
        target = next;
    }
}
