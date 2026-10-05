import type { AuthenticatedClient } from "../../types/ws";
import Log from "../../Log";
import deviceRegistry from "./DeviceRegistry";
import resultBroker from "../../tools/ResultBroker";

class ConnectionManager {
    private clients = new Map<string, AuthenticatedClient>();
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private pongCheckTimer: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_INTERVAL = 30000;
    private readonly CLIENT_TIMEOUT = 60000;
    private readonly PONG_WINDOW = 20000;

    start(): void {
        this.heartbeatTimer = setInterval(() => this.sweepClients(), this.HEARTBEAT_INTERVAL);
        Log.info("ConnectionManager started", { heartbeatInterval: this.HEARTBEAT_INTERVAL });
    }

    register(client: AuthenticatedClient): void {
        this.clients.set(client.id, client);
        Log.info("Client connected", { clientId: client.id, role: client.role, total: this.clients.size });
    }

    unregister(clientId: string): void {
        const client = this.clients.get(clientId);
        if (client) {
            const deviceId = deviceRegistry.onClientDisconnect(clientId);
            if (deviceId) {
                resultBroker.failForDevice(deviceId, "Device disconnected before returning tool result");
            }
            try { client.ws.terminate(); } catch {}
            this.clients.delete(clientId);
            Log.info("Client disconnected", { clientId, total: this.clients.size });
        }
    }

    get(clientId: string): AuthenticatedClient | undefined {
        return this.clients.get(clientId);
    }

    getAll(): AuthenticatedClient[] {
        return Array.from(this.clients.values());
    }

    getByApiKey(apiKeyId: string): AuthenticatedClient | undefined {
        for (const client of this.clients.values()) {
            if (client.apiKeyId === apiKeyId) return client;
        }
        return undefined;
    }

    touch(clientId: string): void {
        const client = this.clients.get(clientId);
        if (client) {
            client.lastActivityAt = Date.now();
            client.isAlive = true;
        }
    }

    broadcast(data: string | Buffer): void {
        for (const client of this.clients.values()) {
            if (client.ws.readyState === 1) {
                client.ws.send(data);
                client.lastActivityAt = Date.now();
            }
        }
    }

    broadcastExcept(excludeId: string, data: string | Buffer): void {
        for (const client of this.clients.values()) {
            if (client.id !== excludeId && client.ws.readyState === 1) {
                client.ws.send(data);
                client.lastActivityAt = Date.now();
            }
        }
    }

    send(clientId: string, data: string | Buffer): boolean {
        const client = this.clients.get(clientId);
        if (!client || client.ws.readyState !== 1) return false;
        client.ws.send(data);
        client.lastActivityAt = Date.now();
        return true;
    }

    getCount(): number {
        return this.clients.size;
    }

    private sweepClients(): void {
        const now = Date.now();
        if (this.pongCheckTimer) {
            clearTimeout(this.pongCheckTimer);
            this.pongCheckTimer = null;
        }
        for (const [id, client] of this.clients) {
            if (now - client.lastActivityAt > this.CLIENT_TIMEOUT) {
                Log.warn("Client timed out", { clientId: id, lastActive: client.lastActivityAt });
                this.unregister(id);
                continue;
            }
            client.isAlive = false;
            try {
                client.ws.ping();
            } catch (err: any) {
                Log.warn("WS ping failed", { clientId: id, error: err?.message ?? String(err) });
                this.unregister(id);
            }
        }
        this.pongCheckTimer = setTimeout(() => this.killUnresponsive(), this.PONG_WINDOW);
    }

    private killUnresponsive(): void {
        this.pongCheckTimer = null;
        for (const [id, client] of this.clients) {
            if (!client.isAlive) {
                Log.warn("Client heartbeat timeout", { clientId: id });
                this.unregister(id);
            }
        }
    }

    stop(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.pongCheckTimer) {
            clearTimeout(this.pongCheckTimer);
            this.pongCheckTimer = null;
        }
        for (const client of this.clients.values()) {
            try { client.ws.terminate(); } catch {}
        }
        this.clients.clear();
    }
}

const connectionManager = new ConnectionManager();
export default connectionManager;
