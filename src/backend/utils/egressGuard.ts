import type { ProvenanceState } from "./provenance";
import { guardsEnabled } from "./provenance";

/**
 * Outbound guardrails for tainted conversations.
 *
 * Once a conversation has read external content, a prompt-injected model may
 * try to carry local data out through a URL (query string, path, subdomain),
 * a request body or headers. No approval prompt is added. Instead, a call is
 * blocked only when what it sends actually contains:
 *
 * - a secret-looking value (API key, token, password, private key, the value
 *   of a secret env var), or
 * - text read earlier from local sources (files, git, processes, clipboard,
 *   memory), including its URI/base64/hex-encoded forms. Short, low-entropy
 *   or ID-like overlaps (commit SHAs, cursors, issue numbers) don't count.
 *
 * Being in a tainted conversation is not enough on its own: any method, body
 * or header is fine as long as it carries neither. URLs and browser_type text
 * are capped at JARVIS_TAINTED_MAX_OUTBOUND_CHARS (default 4096).
 *
 * Values the user typed, and URLs the user or their own files gave, are not
 * treated as exfiltration. When the user explicitly approves a call (for
 * example http_request), only the secret check still applies.
 *
 * Tool results are passed through `redactSecrets` before reaching the model.
 */

/** Tools whose output is the user's local data (worth protecting from egress). */
const LOCAL_DATA_SOURCES = new Set([
    "read_file", "grep_files", "search_files", "list_dir",
    "git_status", "git_log", "git_diff",
    "list_processes", "get_system_info",
    "recall", "list_memories", "list_events",
    "device_get_clipboard", "device_list_contacts", "device_get_location",
]);

const URL_PARAM_TOOLS: Record<string, string> = {
    fetch_url: "url",
    http_request: "url",
    browser_open: "url",
    device_open_url: "url",
};

const SHINGLE = 20;
const STEP = 5;
const MAX_SHINGLES = 60000;
const MAX_LOCAL_TEXT = 256 * 1024;
/** A local-data overlap must be at least this long... */
const MIN_MATCH_CHARS = 24;
/** ...and at least this varied (bits/char), so padding or repeated characters don't count. */
const MIN_MATCH_ENTROPY = 3.0;

export function maxOutboundChars(): number {
    const parsed = parseInt(process.env.JARVIS_TAINTED_MAX_OUTBOUND_CHARS || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 4096;
}

function normalize(text: string): string {
    return text.replace(/\s+/g, " ");
}

function stringLeaves(value: unknown, out: string[], depth = 0): void {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === "string") out.push(value);
    else if (typeof value === "number" || typeof value === "bigint") return;
    else if (Array.isArray(value)) value.forEach(v => stringLeaves(v, out, depth + 1));
    else if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach(v => stringLeaves(v, out, depth + 1));
}

export function isLocalDataSource(name: string): boolean {
    return LOCAL_DATA_SOURCES.has(name);
}

/** Fingerprints text returned by a local-data tool so it can be recognised in outbound requests. */
export function recordLocalData(state: ProvenanceState, data: unknown): void {
    const leaves: string[] = [];
    stringLeaves(data, leaves);
    if (!state.localShingles) state.localShingles = new Set();
    for (const leaf of leaves) {
        const text = normalize(leaf);
        if (text.length < SHINGLE) continue;
        if ((state.localText?.length ?? 0) < MAX_LOCAL_TEXT) {
            state.localText = ((state.localText ?? "") + "\n" + text).slice(0, MAX_LOCAL_TEXT);
        }
        for (let i = 0; i + SHINGLE <= text.length && state.localShingles.size < MAX_SHINGLES; i += STEP) {
            state.localShingles.add(text.slice(i, i + SHINGLE));
        }
    }
}

/** IDs, hashes and cursors: a single token of word characters, no spaces or punctuation. */
function isIdLike(text: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(text.trim());
}

/** Shingles of text the user typed; overlaps made only of these are ignored. */
function shinglesOf(texts: string[]): Set<string> {
    const out = new Set<string>();
    for (const raw of texts) {
        const text = normalize(raw);
        for (let i = 0; i + SHINGLE <= text.length && out.size < MAX_SHINGLES; i++) out.add(text.slice(i, i + SHINGLE));
    }
    return out;
}

/**
 * Returns the first stretch of `candidate` that was read from local data and
 * is long and varied enough to matter, or null.
 */
function localDataMatch(state: ProvenanceState, candidate: string, userShingles: Set<string>): string | null {
    const set = state.localShingles;
    if (!set || set.size === 0) return null;
    const text = normalize(candidate);
    let spanStart = -1;
    let spanEnd = -1;
    const qualifies = (start: number, end: number) => {
        const span = text.slice(start, end);
        return span.length >= MIN_MATCH_CHARS && entropy(span) >= MIN_MATCH_ENTROPY && !isIdLike(span);
    };
    for (let i = 0; i + SHINGLE <= text.length; i++) {
        const window = text.slice(i, i + SHINGLE);
        if (!set.has(window) || userShingles.has(window)) continue;
        if (spanStart !== -1 && i <= spanEnd) {
            spanEnd = i + SHINGLE;
            continue;
        }
        if (spanStart !== -1 && qualifies(spanStart, spanEnd)) return text.slice(spanStart, spanEnd);
        spanStart = i;
        spanEnd = i + SHINGLE;
    }
    if (spanStart !== -1 && qualifies(spanStart, spanEnd)) return text.slice(spanStart, spanEnd);
    return null;
}

function printable(text: string): boolean {
    if (!text) return false;
    let ok = 0;
    for (const ch of text) {
        const c = ch.charCodeAt(0);
        if ((c >= 32 && c < 127) || c === 9 || c === 10 || c === 13 || c > 159) ok++;
    }
    return ok / text.length > 0.9;
}

/** The candidate plus its URI-, base64- and hex-decoded forms. */
export function decodedVariants(candidate: string): string[] {
    const out = new Set<string>([candidate]);
    try {
        out.add(decodeURIComponent(candidate.replace(/\+/g, " ")));
    } catch {
        // malformed escapes: keep the raw form only
    }
    for (const base of Array.from(out)) {
        for (const token of base.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) || []) {
            const b64 = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
            if (printable(b64)) out.add(b64);
        }
        for (const token of base.match(/[0-9a-fA-F]{16,}/g) || []) {
            const hex = Buffer.from(token.length % 2 === 0 ? token : token.slice(0, -1), "hex").toString("utf8");
            if (printable(hex)) out.add(hex);
        }
    }
    return Array.from(out);
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

const TOKEN_PATTERNS: RegExp[] = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
    /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
    /\bsk-[A-Za-z0-9_-]{20,}/g,
    /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    /\bAIza[0-9A-Za-z_-]{35}\b/g,
    /\bya29\.[0-9A-Za-z_-]{20,}/g,
    /\b1\/\/[0-9A-Za-z_-]{20,}/g,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    /\bjvs_[A-Za-z0-9_-]{16,}/g,
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
    /\bBasic\s+[A-Za-z0-9+/]{12,}=*/g,
];

const SENSITIVE_NAME = "[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|pass(?:w(?:or)?d|wd)?(?![a-z])|pwd|private[_-]?key|access[_-]?key|credentials?|authorization)[A-Za-z0-9_.-]*";
// KEY=VALUE (.env), "key": "value" (JSON, possibly JSON-escaped), key: value (YAML).
const ASSIGNMENT = new RegExp(`(["']?)(${SENSITIVE_NAME})\\1(\\s*[:=]\\s*)(\\\\?["']?)([^\\s"'\\\\,;&<>]{6,})`, "gi");
/**
 * Env var names are matched on whole `_`-separated words, so JARVIS_MASTER_KEY
 * or SMTP_PASS count but PWD, KEYBOARD_LAYOUT or PASSTHROUGH don't.
 */
const SECRET_ENV_WORDS = new Set([
    "KEY", "KEYS", "APIKEY", "TOKEN", "TOKENS", "SECRET", "SECRETS",
    "PASS", "PASSWORD", "PASSWD", "PASSPHRASE", "CREDENTIAL", "CREDENTIALS", "AUTH",
]);
const NON_SECRET_ENV_NAMES = new Set([
    "PWD", "OLDPWD", "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "SSH_AUTH_SOCK",
]);

export function isSecretEnvName(name: string): boolean {
    const upper = name.toUpperCase();
    if (NON_SECRET_ENV_NAMES.has(upper) || upper.startsWith("LC_")) return false;
    return upper.split(/[^A-Z0-9]+/).some(word => SECRET_ENV_WORDS.has(word));
}

function secretEnvValues(): string[] {
    const values: string[] = [];
    for (const [name, value] of Object.entries(process.env)) {
        if (value && value.length >= 8 && isSecretEnvName(name)) values.push(value);
    }
    return values.sort((a, b) => b.length - a.length);
}

/** Names that contain a sensitive word but hold ordinary values (pagination, token counts, ...). */
const NON_SECRET_ASSIGNMENT_NAME = /^(?:(?:next|prev(?:ious)?)_?)?page_?token$|^(?:sync|continuation|resumption)_?token$|tokeni[sz]|tokens$|token_?(?:count|type|usage|limit|budget)s?$|^max_?(?:new_?)?tokens?/i;

/** Shannon entropy in bits per character. */
export function entropy(text: string): number {
    if (!text) return 0;
    const counts = new Map<string, number>();
    for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let bits = 0;
    for (const n of counts.values()) {
        const p = n / text.length;
        bits -= p * Math.log2(p);
    }
    return bits;
}

/**
 * Decides whether the value of a `token = ...` style assignment is an actual
 * secret rather than code (`req.headers.authorization`, `loadTokenizer()`),
 * a placeholder or a short pagination cursor.
 */
function looksLikeAssignedSecret(name: string, sep: string, quote: string, rawValue: string): boolean {
    // Drop object paths (config.token) and the "n" of a JSON-escaped newline before KEY=value.
    const bareName = name.replace(/^.*[.]/, "").replace(/^n(?=[A-Z][A-Z0-9_]*$)/, "");
    if (NON_SECRET_ASSIGNMENT_NAME.test(bareName)) return false;
    const value = rawValue.replace(/[\\"';)]+$/, "");
    if (value.length < 6 || value.startsWith("[REDACTED")) return false;
    if (/^\d+$/.test(value) || /^(true|false|null|undefined|none|nil|yes|no)$/i.test(value)) return false;
    // Code: calls, member access, template/shell/env references.
    if (/[()[\]{}]/.test(value) || /^[$%]/.test(value) || /^(process\.env|os\.environ|env\.)/.test(value)) return false;
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(value)) return false;
    if (/^(?:x+|\*+|\.+|<[^>]*>|your[_-].*|changeme|example|placeholder)$/i.test(value)) return false;

    // A quoted literal, or KEY=value in .env style, is taken at face value.
    const envStyle = /^[A-Z0-9_]+$/.test(bareName) && sep.trim() === "=" && !/\s/.test(sep);
    if (quote || envStyle) return true;

    // Unquoted (YAML, code, URLs): require something that looks random.
    if (value.length < 8) return false;
    const hasLetter = /[A-Za-z]/.test(value);
    const hasDigit = /\d/.test(value);
    const hasSymbol = /[^A-Za-z0-9_.-]/.test(value);
    if (hasLetter && (hasDigit || hasSymbol)) return true;
    return value.length >= 16 && entropy(value) >= 3.5;
}

/** Replaces secret-looking strings with "[REDACTED]". */
export function redactSecrets(text: string): { text: string; count: number } {
    let count = 0;
    let out = text;
    for (const value of secretEnvValues()) {
        if (out.includes(value)) {
            const parts = out.split(value);
            count += parts.length - 1;
            out = parts.join("[REDACTED]");
        }
    }
    for (const pattern of TOKEN_PATTERNS) {
        out = out.replace(pattern, () => {
            count++;
            return "[REDACTED]";
        });
    }
    out = out.replace(ASSIGNMENT, (match, q1: string, name: string, sep: string, q2: string, value: string) => {
        if (!looksLikeAssignedSecret(name, sep, q2, value)) return match;
        count++;
        return `${q1}${name}${q1}${sep}${q2}[REDACTED]`;
    });
    return { text: out, count };
}

export function containsSecret(text: string): boolean {
    return decodedVariants(text).some(v => redactSecrets(v).count > 0);
}

// ---------------------------------------------------------------------------
// Outbound checks
// ---------------------------------------------------------------------------

export interface OutboundContext {
    /** Messages the user typed in this conversation. */
    userTexts?: string[];
    /** The user will approve (or already approved) this exact call: only secrets still block it. */
    approved?: boolean;
}

const URL_PATTERN = /https?:\/\/[^\s"'<>\\`)\]}]+/g;

function urlsIn(texts: Array<string | undefined>): URL[] {
    const out: URL[] = [];
    for (const text of texts) {
        if (!text) continue;
        for (const raw of text.match(URL_PATTERN) || []) {
            try {
                out.push(new URL(raw.replace(/[.,;:!?]+$/, "")));
            } catch {
                // not a URL after all
            }
        }
        if (out.length > 2000) break;
    }
    return out;
}

/**
 * Drops the parts of `url` that come from a URL the user or their own files gave:
 * a matching host plus path prefix, and query parameters with the same value.
 * `github.com/me/repo/issues/39` is then judged on "/39" alone.
 */
function untrustedParts(url: URL, trusted: URL[]): { pathname: string; search: string } {
    let pathname = url.pathname;
    let params = Array.from(url.searchParams.entries());
    for (const t of trusted) {
        if (t.hostname !== url.hostname) continue;
        const prefix = t.pathname.replace(/\/+$/, "");
        if (prefix && (pathname === prefix || pathname.startsWith(prefix + "/"))) pathname = pathname.slice(prefix.length);
        params = params.filter(([k, v]) => t.searchParams.get(k) !== v);
    }
    return { pathname, search: params.map(([k, v]) => `${k}=${v}`).join("&") };
}

/** Removes words the user typed (8+ chars) so their own tokens or text don't trigger a block. */
function withoutUserTyped(text: string, userTexts: string[]): string {
    let out = text;
    for (const userText of userTexts) {
        for (const word of userText.split(/\s+/)) {
            if (word.length >= 8 && out.includes(word)) out = out.split(word).join(" ");
        }
    }
    return out;
}

function stringify(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Returns a reason string if the outbound call must be blocked, or null.
 * Only applies when the conversation is tainted and guards are enabled.
 */
export function checkOutbound(
    name: string,
    params: Record<string, unknown>,
    state: ProvenanceState | undefined,
    context: OutboundContext = {},
): string | null {
    if (!state?.tainted || !guardsEnabled()) return null;
    const userTexts = context.userTexts ?? [];
    const approved = !!context.approved;
    const limit = maxOutboundChars();
    const prefix = "Blocked because this conversation has read external content (mail, web, documents) and";
    const userShingles = shinglesOf(userTexts);

    // Each piece is something the call would send; `what` names it in the reason.
    const pieces: Array<{ what: string; text: string; capped?: boolean }> = [];

    if (name === "browser_type") {
        const text = typeof params.text === "string" ? params.text : "";
        if (text) pieces.push({ what: "the text", text, capped: true });
    }

    const urlParam = URL_PARAM_TOOLS[name];
    const url = urlParam && typeof params[urlParam] === "string" ? (params[urlParam] as string) : "";
    const userGaveUrl = !!url && (userTexts.some(t => t.includes(url)) || (url.length >= 12 && !!state.localText?.includes(url)));
    if (url && !userGaveUrl) {
        if (!approved && url.length > limit) return `${prefix} the URL is longer than ${limit} characters.`;
        let parsed: URL | null = null;
        try {
            parsed = new URL(url);
        } catch {
            // the tool itself rejects invalid URLs
        }
        if (parsed) {
            const { pathname, search } = untrustedParts(parsed, urlsIn([...userTexts, state.localText]));
            // Hostnames only matter through unusually long labels (DNS exfil), so a
            // domain mentioned in a local file doesn't block normal browsing.
            const longLabels = parsed.hostname.split(".").filter(label => label.length >= SHINGLE);
            const text = [parsed.username, parsed.password, ...longLabels, pathname, search, parsed.hash].filter(Boolean).join(" ");
            pieces.push({ what: "the URL", text });
        }
    }

    if (name === "http_request") {
        const body = stringify(params.body);
        if (body) pieces.push({ what: "the request body", text: body });
        if (params.headers && typeof params.headers === "object") {
            const values = Object.values(params.headers as Record<string, unknown>).map(stringify).filter(Boolean);
            if (values.length > 0) pieces.push({ what: "the request headers", text: values.join("\n") });
        }
    }

    for (const piece of pieces) {
        if (piece.capped && !approved && piece.text.length > limit) return `${prefix} ${piece.what} is longer than ${limit} characters.`;
        const text = withoutUserTyped(piece.text, userTexts);
        if (containsSecret(text)) {
            return `${prefix} ${piece.what} contains a secret-looking value (API key, token, password or private key).`;
        }
        if (approved) continue;
        if (decodedVariants(text).some(v => localDataMatch(state, v, userShingles) !== null)) {
            return `${prefix} ${piece.what} contains data read earlier from local files or other private sources.`;
        }
    }
    return null;
}
