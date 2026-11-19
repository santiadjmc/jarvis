import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import Log from "../../Log";

export const GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
];

interface StoredTokens extends Credentials {
    savedAt: number;
    /** When the current refresh token stops working, if known. */
    refreshExpiresAt?: number | null;
}

function dataDir(): string {
    return process.env.JARVIS_DATA_DIR || join(homedir(), ".local", "share", "jarvis");
}

function tokenPath(): string {
    return join(dataDir(), "google_tokens.json");
}

function loadTokens(): StoredTokens | null {
    try {
        const path = tokenPath();
        if (!existsSync(path)) return null;
        return JSON.parse(readFileSync(path, "utf-8")) as StoredTokens;
    } catch {
        return null;
    }
}

/**
 * expiry_date is the ~1h access token, refreshed on demand, so it says nothing
 * about whether the connection is healthy. The refresh token's lifetime comes
 * from Google's refresh_token_expires_in (sent for time-limited "Testing" apps)
 * or GOOGLE_REFRESH_TOKEN_DAYS; otherwise it is treated as non-expiring.
 */
function refreshExpiry(tokens: Credentials, previous: StoredTokens | null, now: number): number | null {
    if (previous?.refresh_token && previous.refresh_token === tokens.refresh_token) {
        return previous.refreshExpiresAt ?? null;
    }
    const expiresIn = Number((tokens as { refresh_token_expires_in?: unknown }).refresh_token_expires_in);
    if (Number.isFinite(expiresIn) && expiresIn > 0) return now + expiresIn * 1000;
    const days = parseFloat(process.env.GOOGLE_REFRESH_TOKEN_DAYS || "");
    if (Number.isFinite(days) && days > 0) return now + days * 86400000;
    return null;
}

function saveTokens(tokens: Credentials): void {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const stored: StoredTokens = { ...tokens, savedAt: now, refreshExpiresAt: refreshExpiry(tokens, loadTokens(), now) };
    writeFileSync(tokenPath(), JSON.stringify(stored, null, 2), { mode: 0o600 });
}

function clearTokens(): void {
    const path = tokenPath();
    if (existsSync(path)) writeFileSync(path, "{}");
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set in .env`);
    return value;
}

function buildOAuthClient(): OAuth2Client {
    return new google.auth.OAuth2(
        requireEnv("GOOGLE_CLIENT_ID"),
        requireEnv("GOOGLE_CLIENT_SECRET"),
        requireEnv("GOOGLE_REDIRECT_URI"),
    );
}

let pendingState: string | null = null;

const CONNECT_TOKEN_TTL_MS = 10 * 60 * 1000;
const connectTokens = new Map<string, number>();

/**
 * One-time token that authorizes a non-loopback browser to start the Google
 * OAuth flow. Issued only over an authenticated WS connection.
 */
export function issueConnectToken(): string {
    const now = Date.now();
    for (const [token, expiresAt] of connectTokens) {
        if (expiresAt <= now) connectTokens.delete(token);
    }
    const token = randomBytes(24).toString("base64url");
    connectTokens.set(token, now + CONNECT_TOKEN_TTL_MS);
    return token;
}

export function consumeConnectToken(token: string): boolean {
    const expiresAt = connectTokens.get(token);
    if (expiresAt === undefined) return false;
    connectTokens.delete(token);
    return expiresAt > Date.now();
}

export function isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function getAuthUrl(): string {
    const client = buildOAuthClient();
    pendingState = randomBytes(16).toString("hex");
    return client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: GOOGLE_SCOPES,
        state: pendingState,
    });
}

export async function handleCallback(code: string, state: string): Promise<void> {
    if (!pendingState || state !== pendingState) {
        throw new Error("Invalid OAuth state (possible CSRF or stale link)");
    }
    pendingState = null;
    const client = buildOAuthClient();
    const { tokens } = await client.getToken(code);
    saveTokens(tokens);
    Log.info("Google account connected", { scopes: tokens.scope });
}

export function disconnect(): void {
    clearTokens();
    Log.info("Google account disconnected");
}

export function status(): { connected: boolean; connectedAt: number | null; expiresInDays: number | null; scopes: string[] } {
    const tokens = loadTokens();
    if (!tokens || !tokens.refresh_token) {
        return { connected: false, connectedAt: null, expiresInDays: null, scopes: [] };
    }
    const expiresInDays = tokens.refreshExpiresAt ? Math.round((tokens.refreshExpiresAt - Date.now()) / 86400000 * 10) / 10 : null;
    return {
        connected: true,
        connectedAt: tokens.savedAt,
        expiresInDays,
        scopes: typeof tokens.scope === "string" ? tokens.scope.split(" ") : [],
    };
}

export async function getGoogleClient(): Promise<OAuth2Client> {
    const tokens = loadTokens();
    if (!tokens || !tokens.refresh_token) {
        throw new Error("No Google account connected. Ask the user to open the Jarvis server's /oauth/google/start URL in a browser to connect one.");
    }
    const client = buildOAuthClient();
    client.setCredentials(tokens);
    client.on("tokens", (newTokens) => {
        saveTokens({ ...tokens, ...newTokens });
    });
    return client;
}
