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

function saveTokens(tokens: Credentials): void {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    const stored: StoredTokens = { ...tokens, savedAt: Date.now() };
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
    const expiresInDays = tokens.expiry_date ? Math.round((tokens.expiry_date - Date.now()) / 86400000 * 10) / 10 : null;
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
