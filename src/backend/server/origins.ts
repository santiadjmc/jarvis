const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Browser origins allowed to call the HTTP API and open the WebSocket.
 * Localhost on any port is always allowed; CORS_ORIGINS adds more origins
 * (comma-separated) on top of that, and "*" allows any origin.
 */
export function originAllowed(origin: string): boolean {
    if (LOCALHOST_ORIGIN.test(origin)) return true;
    const configured = (process.env.CORS_ORIGINS || "")
        .split(",")
        .map(o => o.trim())
        .filter(Boolean);
    return configured.includes("*") || configured.includes(origin);
}
