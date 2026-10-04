import express from "express";
import cors from "cors";
import { createServer, type Server as HTTPServer } from "http";
import wsServer from "./ws/WebSocketServer";
import connectionManager from "./ws/ConnectionManager";
import { getLocalAddresses } from "../utils/network";
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
        this.app.use(cors({
            origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:*"],
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
                },
            });
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

export default Server;
