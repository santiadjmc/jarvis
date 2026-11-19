import type { ProvenanceState } from "./provenance";
import { guardsEnabled } from "./provenance";

/**
 * Outbound guardrails for tainted conversations (sec H1 remainder).
 *
 * Once a conversation has read external content, a prompt-injected model may
 * try to carry local data out through a URL (query string, path, subdomain),
 * a request body or headers. No approval prompt is added; instead:
 *
 * - fetch_url / http_request / browser_open / device_open_url URLs are capped
 *   in length and blocked if they contain secret-looking strings or text read
 *   earlier from local sources (files, git, processes, clipboard, memory),
 *   including its URI/base64/hex-encoded forms;
 * - http_request is limited to GET/HEAD with no body and only benign headers;
 * - browser_type text gets the same size/secret/local-data checks;
 * - tool results are passed through `redactSecrets` before reaching the model.
 *
 * A URL the user typed themselves, or one that appears verbatim in local data
 * (a link from their own files), is not treated as exfiltration.
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

const BENIGN_HEADERS = new Set(["accept", "accept-language", "user-agent"]);

const SHINGLE = 20;
const STEP = 5;
const MAX_SHINGLES = 60000;
const MAX_LOCAL_TEXT = 256 * 1024;

export function maxOutboundChars(): number {
    const parsed = parseInt(process.env.JARVIS_TAINTED_MAX_OUTBOUND_CHARS || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 512;
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

function containsLocalData(state: ProvenanceState, candidate: string): boolean {
    const set = state.localShingles;
    if (!set || set.size === 0) return false;
    const text = normalize(candidate);
    for (let i = 0; i + SHINGLE <= text.length; i++) {
        if (set.has(text.slice(i, i + SHINGLE))) return true;
    }
    return false;
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

function payloadProblem(state: ProvenanceState, payload: string): string | null {
    if (containsSecret(payload)) return "it contains a secret-looking value (API key, token, password or private key)";
    if (decodedVariants(payload).some(v => containsLocalData(state, v))) return "it contains data read earlier from local files or other private sources";
    return null;
}

/**
 * Returns a reason string if the outbound call must be blocked, or null.
 * Only applies when the conversation is tainted and guards are enabled.
 */
export function checkOutbound(
    name: string,
    params: Record<string, unknown>,
    state: ProvenanceState | undefined,
    userTexts: string[] = [],
): string | null {
    if (!state?.tainted || !guardsEnabled()) return null;
    const limit = maxOutboundChars();
    const prefix = "Blocked because this conversation has read external content (mail, web, documents) and";

    if (name === "http_request") {
        const method = typeof params.method === "string" ? params.method.toUpperCase() : "GET";
        if (method !== "GET" && method !== "HEAD") return `${prefix} only GET/HEAD requests are allowed now (got ${method}).`;
        if (params.body !== undefined && params.body !== null && String(params.body) !== "") return `${prefix} request bodies are not allowed now.`;
        if (params.headers && typeof params.headers === "object") {
            const extra = Object.keys(params.headers as Record<string, unknown>).filter(h => !BENIGN_HEADERS.has(h.toLowerCase()));
            if (extra.length > 0) return `${prefix} custom headers are not allowed now (${extra.join(", ")}).`;
        }
    }

    if (name === "browser_type") {
        const text = typeof params.text === "string" ? params.text : "";
        if (text.length > limit) return `${prefix} the text is longer than ${limit} characters.`;
        const problem = payloadProblem(state, text);
        return problem ? `${prefix} ${problem}.` : null;
    }

    const urlParam = URL_PARAM_TOOLS[name];
    if (!urlParam) return null;
    const url = typeof params[urlParam] === "string" ? (params[urlParam] as string) : "";
    if (!url) return null;
    if (userTexts.some(t => t.includes(url))) return null;
    if (state.localText && url.length >= 12 && state.localText.includes(url)) return null;
    if (url.length > limit) return `${prefix} the URL is longer than ${limit} characters.`;

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null; // the tool itself rejects invalid URLs
    }
    if (containsSecret([parsed.username, parsed.password, parsed.hostname, parsed.pathname, parsed.search, parsed.hash].join(" "))) {
        return `${prefix} the URL contains a secret-looking value (API key, token, password or private key).`;
    }
    // Hostnames are only checked through unusually long labels (DNS exfil), so
    // a domain mentioned in a local file doesn't block normal browsing.
    const longLabels = parsed.hostname.split(".").filter(label => label.length >= SHINGLE);
    const payload = [parsed.username, parsed.password, ...longLabels, parsed.pathname, parsed.search, parsed.hash].join(" ");
    if (decodedVariants(payload).some(v => containsLocalData(state, v))) {
        return `${prefix} the URL contains data read earlier from local files or other private sources.`;
    }
    return null;
}
