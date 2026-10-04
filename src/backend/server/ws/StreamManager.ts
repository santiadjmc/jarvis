import { v4 as uuid } from "uuid";
import type { ActiveStream } from "../../types/ws";
import Log from "../../Log";

class StreamManager {
    private activeStreams = new Map<string, ActiveStream>();
    private readonly STREAM_TIMEOUT = 120000;

    create(clientId: string, sessionId: string, model: string, abortController: AbortController, requestId = uuid()): string {
        if (this.activeStreams.has(requestId)) {
            throw new Error(`A stream is already active for request ${requestId}`);
        }
        this.activeStreams.set(requestId, {
            requestId,
            clientId,
            sessionId,
            model,
            startedAt: Date.now(),
            abortController,
            fullResponse: "",
        });
        Log.debug("Stream created", { requestId, clientId, sessionId, model });
        return requestId;
    }

    appendToken(requestId: string, token: string): void {
        const stream = this.activeStreams.get(requestId);
        if (stream) stream.fullResponse += token;
    }

    getFullResponse(requestId: string): string {
        return this.activeStreams.get(requestId)?.fullResponse ?? "";
    }

    get(requestId: string): ActiveStream | undefined {
        return this.activeStreams.get(requestId);
    }

    cancel(requestId: string): boolean {
        const stream = this.activeStreams.get(requestId);
        if (!stream) return false;
        stream.abortController.abort();
        this.activeStreams.delete(requestId);
        Log.info("Stream cancelled", { requestId, clientId: stream.clientId });
        return true;
    }

    complete(requestId: string): ActiveStream | undefined {
        const stream = this.activeStreams.get(requestId);
        if (stream) this.activeStreams.delete(requestId);
        return stream;
    }

    cancelByClient(clientId: string): number {
        let cancelled = 0;
        for (const [id, stream] of this.activeStreams) {
            if (stream.clientId === clientId) {
                stream.abortController.abort();
                this.activeStreams.delete(id);
                cancelled++;
            }
        }
        return cancelled;
    }

    getActiveCount(): number {
        return this.activeStreams.size;
    }

    getClientStreams(clientId: string): ActiveStream[] {
        return Array.from(this.activeStreams.values()).filter(s => s.clientId === clientId);
    }

    cleanupStale(): number {
        let cleaned = 0;
        const now = Date.now();
        for (const [id, stream] of this.activeStreams) {
            if (now - stream.startedAt > this.STREAM_TIMEOUT) {
                stream.abortController.abort();
                this.activeStreams.delete(id);
                cleaned++;
            }
        }
        return cleaned;
    }
}

const streamManager = new StreamManager();
export default streamManager;
