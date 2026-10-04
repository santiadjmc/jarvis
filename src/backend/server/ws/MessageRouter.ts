import { v4 as uuid } from "uuid";
import type { WebSocket } from "ws";
import type { AuthenticatedClient, ServerMessage } from "../../types/ws";
import type { ValidatedClientMessage } from "./Protocol";
import connectionManager from "./ConnectionManager";
import streamManager from "./StreamManager";
import Log from "../../Log";

type MessageHandler = (client: AuthenticatedClient, message: ValidatedClientMessage) => Promise<void> | void;
type BinaryHandler = (client: AuthenticatedClient, messageId: string, data: Buffer) => Promise<void> | void;

class MessageRouter {
    private handlers = new Map<string, MessageHandler>();
    private binaryHandlers = new Map<string, BinaryHandler>();
    private aiHandler: ((client: AuthenticatedClient, message: any) => Promise<void>) | null = null;
    private voiceHandler: ((client: AuthenticatedClient, messageId: string, data: Buffer) => Promise<void>) | null = null;

    register(type: string, handler: MessageHandler): void {
        this.handlers.set(type, handler);
    }

    registerBinary(type: string, handler: BinaryHandler): void {
        this.binaryHandlers.set(type, handler);
    }

    setAIHandler(handler: (client: AuthenticatedClient, message: any) => Promise<void>): void {
        this.aiHandler = handler;
    }

    setVoiceHandler(handler: (client: AuthenticatedClient, messageId: string, data: Buffer) => Promise<void>): void {
        this.voiceHandler = handler;
    }

    async route(client: AuthenticatedClient, message: ValidatedClientMessage): Promise<void> {
        const handler = this.handlers.get(message.type);
        if (handler) {
            try {
                await handler(client, message);
            } catch (err: any) {
                Log.error("Message handler error", err);
                this.sendError(client.ws, "HANDLER_ERROR", "Internal error processing message", (message as any).id);
            }
            return;
        }

        if (message.type === "chat" && this.aiHandler) {
            try {
                await this.aiHandler(client, message);
            } catch (err: any) {
                Log.error("AI handler error", err);
                this.sendError(client.ws, "AI_ERROR", "Error processing chat message", message.id);
            }
            return;
        }

        Log.warn("Unhandled message type", { type: message.type, clientId: client.id });
        this.sendError(client.ws, "UNKNOWN_TYPE", `No handler for message type: ${message.type}`);
    }

    async routeBinary(client: AuthenticatedClient, messageId: string, data: Buffer): Promise<void> {
        if (this.voiceHandler) {
            try {
                await this.voiceHandler(client, messageId, data);
            } catch (err: any) {
                Log.error("Voice handler error", err);
                this.sendError(client.ws, "VOICE_ERROR", "Error processing voice data", messageId);
            }
            return;
        }
        Log.warn("No voice handler registered", { clientId: client.id });
    }

    sendToClient(clientId: string, message: ServerMessage): void {
        const client = connectionManager.get(clientId);
        if (client && client.ws.readyState === 1) {
            client.ws.send(JSON.stringify(message));
        }
    }

    private sendError(ws: WebSocket, code: string, message: string, requestId?: string): void {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({
                type: "error",
                id: uuid(),
                code,
                message,
                requestId,
            }));
        }
    }
}

const messageRouter = new MessageRouter();
export default messageRouter;
