import { WebSocketServer as WSServer, WebSocket } from "ws";
import { v4 as uuid } from "uuid";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { AuthenticatedClient } from "../../types/ws";
import connectionManager from "./ConnectionManager";
import deviceRegistry from "./DeviceRegistry";
import streamManager from "./StreamManager";
import { validateMessage } from "./Protocol";
import MessageRouter from "./MessageRouter";
import authService from "../../auth/AuthService";
import Log from "../../Log";

class JarvisWebSocketServer {
    private wss: WSServer | null = null;
    private readonly MAX_PAYLOAD = 4 * 1024 * 1024;
    private readonly MAX_AUTH_FAILURES = 10;
    private readonly AUTH_FAILURE_WINDOW_MS = 60000;
    private authFailures = new Map<string, { count: number; resetAt: number }>();

    private originAllowed(origin: string): boolean {
        const configured = (process.env.CORS_ORIGINS || "")
            .split(",")
            .map(o => o.trim())
            .filter(Boolean);
        if (configured.includes("*")) return true;
        if (configured.includes(origin)) return true;
        return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
    }

    private registerAuthFailure(ip: string): boolean {
        const now = Date.now();
        const entry = this.authFailures.get(ip);
        if (entry && now < entry.resetAt) {
            entry.count++;
            if (entry.count > this.MAX_AUTH_FAILURES) return false;
        } else {
            this.authFailures.set(ip, { count: 1, resetAt: now + this.AUTH_FAILURE_WINDOW_MS });
        }
        return true;
    }

    attach(server: Server): void {
        this.wss = new WSServer({
            server,
            path: "/ws",
            maxPayload: this.MAX_PAYLOAD,
            perMessageDeflate: false,
        });

        this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
        Log.info("WebSocket server attached", { path: "/ws", maxPayload: this.MAX_PAYLOAD });
    }

    private handleConnection(ws: WebSocket, req: IncomingMessage): void {
        const remoteAddress = req.socket.remoteAddress || "unknown";

        const origin = req.headers.origin;
        if (origin && !this.originAllowed(origin)) {
            Log.warn("WS rejected: origin not allowed", { remoteAddress, origin });
            ws.close(4003, "Origin not allowed");
            return;
        }

        const apiKey = this.extractApiKey(req);
        if (!apiKey) {
            Log.warn("WS rejected: missing API key", { remoteAddress });
            ws.close(4001, "Missing API key");
            return;
        }

        const authResult = authService.validateApiKey(apiKey);
        if (!authResult.success) {
            Log.warn("WS rejected: invalid API key", { remoteAddress, reason: authResult.error });
            if (!this.registerAuthFailure(remoteAddress)) {
                Log.warn("WS rejected: too many failed auth attempts", { remoteAddress });
                ws.close(4002, "Too many failed attempts, slow down");
                return;
            }
            ws.close(4003, authResult.error || "Invalid API key");
            return;
        }
        this.authFailures.delete(remoteAddress);

        const clientId = uuid();
        const client: AuthenticatedClient = {
            id: clientId,
            ws,
            apiKeyId: authResult.apiKeyId!,
            role: authResult.role!,
            connectedAt: Date.now(),
            lastActivityAt: Date.now(),
            isAlive: true,
            metadata: {},
        };

        connectionManager.register(client);
        this.sendJson(ws, { type: "connected", clientId, deviceId: null, serverTime: Date.now() });

        ws.on("message", (data: Buffer, isBinary: boolean) => {
            if (isBinary) {
                this.handleBinaryMessage(client, data);
                return;
            }
            this.handleTextMessage(client, data.toString());
        });

        ws.on("close", (code, reason) => {
            Log.info("WS closed", { clientId, code, reason: reason?.toString() });
            streamManager.cancelByClient(clientId);
            connectionManager.unregister(clientId);
        });

        ws.on("error", (err) => {
            Log.warn("WS error", { clientId, error: err.message });
            streamManager.cancelByClient(clientId);
            connectionManager.unregister(clientId);
        });

        ws.on("pong", () => {
            connectionManager.touch(clientId);
        });

        ws.on("ping", () => {
            connectionManager.touch(clientId);
        });
    }

    private handleTextMessage(client: AuthenticatedClient, raw: string): void {
        connectionManager.touch(client.id);
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            this.sendError(client.ws, "PARSE_ERROR", "Invalid JSON");
            return;
        }

        const result = validateMessage(parsed);
        if (!result.success) {
            this.sendError(client.ws, "VALIDATION_ERROR", result.error);
            return;
        }

        MessageRouter.route(client, result.data);
    }

    private handleBinaryMessage(client: AuthenticatedClient, data: Buffer): void {
        connectionManager.touch(client.id);
        if (data.length < 16) {
            this.sendError(client.ws, "INVALID_BINARY", "Binary message too short");
            return;
        }
        const messageId = data.subarray(0, 16).toString("utf-8");
        const audioData = data.subarray(16);
        MessageRouter.routeBinary(client, messageId, audioData);
    }

    private extractApiKey(req: IncomingMessage): string | null {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const fromQuery = url.searchParams.get("key");
        if (fromQuery) return fromQuery;

        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

        return null;
    }

    sendJson(ws: WebSocket, data: unknown): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    sendError(ws: WebSocket, code: string, message: string, requestId?: string): void {
        this.sendJson(ws, { type: "error", id: uuid(), code, message, requestId });
    }

    stop(): void {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
    }
}

const wsServer = new JarvisWebSocketServer();
export default wsServer;
