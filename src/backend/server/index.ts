import express from "express";
import cors from "cors";
import { createServer, type Server as HTTPServer } from "http";
import wsServer from "./ws/WebSocketServer";
import connectionManager from "./ws/ConnectionManager";
import { getLocalAddresses } from "../utils/network";
import { getAuthUrl, handleCallback, isConfigured } from "../agent/Google/googleAuth";
import Log from "../Log";

class Server {
    private app: express.Application;
    private httpServer: HTTPServer | null = null;
    private port: number;
    private host: string;

    constructor(port: number = 3000, host: string = "0.0.0.0") {
        this.port = port;
        this.host = host;
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        const configuredOrigins = (process.env.CORS_ORIGINS || "")
            .split(",")
            .map(origin => origin.trim())
            .filter(Boolean);

        this.app.use(cors({
            origin: (origin, callback) => {
                if (!origin) return callback(null, true);
                if (configuredOrigins.includes("*")) return callback(null, true);
                if (configuredOrigins.length > 0) {
                    return callback(null, configuredOrigins.includes(origin));
                }
                const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
                return callback(null, isLocal);
            },
            methods: ["GET", "POST", "PUT", "DELETE"],
            allowedHeaders: ["Content-Type", "Authorization"],
        }));
        this.app.use(express.json({ limit: "1mb" }));
    }

    private setupRoutes(): void {
        this.app.get("/health", (_, res) => {
            res.json({
                status: "ok",
                uptime: process.uptime(),
                connections: connectionManager.getCount(),
                timestamp: Date.now(),
            });
        });

        this.app.get("/", (_, res) => {
            res.json({
                name: "Jarvis",
                version: "1.0.0",
                status: "running",
                endpoints: {
                    health: "/health",
                    websocket: "/ws?key=<api_key>",
                    googleConnect: "/oauth/google/start",
                },
            });
        });

        this.app.get("/oauth/google/start", (_, res) => {
            if (!isConfigured()) {
                res.status(500).send(oauthPage("Google OAuth isn't configured", "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in the server's .env file first."));
                return;
            }
            res.redirect(getAuthUrl());
        });

        this.app.get("/oauth/google/callback", async (req, res) => {
            const code = typeof req.query.code === "string" ? req.query.code : "";
            const state = typeof req.query.state === "string" ? req.query.state : "";
            const error = typeof req.query.error === "string" ? req.query.error : "";
            if (error) {
                res.status(400).send(oauthPage("Connection cancelled", error));
                return;
            }
            if (!code || !state) {
                res.status(400).send(oauthPage("Missing parameters", "This link is missing the expected code or state."));
                return;
            }
            try {
                await handleCallback(code, state);
                connectionManager.broadcast(JSON.stringify({ type: "google_account_status", connected: true }));
                res.send(oauthPage("Google account connected", "You can close this tab and go back to Jarvis."));
            } catch (err: any) {
                res.status(400).send(oauthPage("Connection failed", err.message));
            }
        });
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.httpServer = createServer(this.app);

            wsServer.attach(this.httpServer);
            connectionManager.start();

            const server = this.httpServer;
            const onError = (err: Error) => {
                server.off("error", onError);
                this.httpServer = null;
                reject(err);
            };
            server.once("error", onError);
            server.listen(this.port, this.host, () => {
                server.off("error", onError);
                const addresses = getLocalAddresses();
                Log.info(`Jarvis server listening`, { host: this.host, port: this.port, lan: addresses.ipv4, lanV6: addresses.ipv6 });
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        connectionManager.stop();
        wsServer.stop();
        if (this.httpServer) {
            return new Promise((resolve) => {
                this.httpServer!.close(() => resolve());
            });
        }
    }

    getHttpServer(): HTTPServer | null {
        return this.httpServer;
    }
}

function oauthPage(title: string, message: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#e6edf3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:420px;padding:32px;text-align:center}
h1{font-size:20px;margin-bottom:12px}
p{color:#9aa7b2;font-size:14px;line-height:1.5}</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}

export default Server;
