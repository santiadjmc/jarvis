import { v4 as uuid } from "uuid";
import type { ActiveStream } from "../../types/ws";
import Log from "../../Log";

export const STREAM_TIMEOUT_REASON = "STREAM_TIMEOUT";

/** Idle limit for a stream; must exceed the approval (60s) and device-tool (90s) waits. */
function streamIdleTimeoutMs(): number {
    const parsed = parseInt(process.env.JARVIS_STREAM_IDLE_TIMEOUT_MS || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 180000;
}

export function isStreamTimeout(signal: AbortSignal): boolean {
    return signal.aborted && (signal.reason as { name?: string } | undefined)?.name === STREAM_TIMEOUT_REASON;
}

class StreamManager {
    private activeStreams = new Map<string, ActiveStream>();

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
            lastActivityAt: Date.now(),
            abortController,
            fullResponse: "",
        });
        Log.debug("Stream created", { requestId, clientId, sessionId, model });
        return requestId;
    }

    appendToken(requestId: string, token: string): void {
        const stream = this.activeStreams.get(requestId);
        if (stream) {
            stream.fullResponse += token;
            stream.lastActivityAt = Date.now();
        }
    }

    /** Marks a stream as making progress (tokens, status changes, tool start/finish). */
    touch(requestId: string): void {
        const stream = this.activeStreams.get(requestId);
        if (stream) stream.lastActivityAt = Date.now();
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
        const limit = streamIdleTimeoutMs();
        for (const [id, stream] of this.activeStreams) {
            if (now - stream.lastActivityAt > limit) {
                const reason = new Error(`No progress for ${Math.round(limit / 1000)}s`);
                reason.name = STREAM_TIMEOUT_REASON;
                stream.abortController.abort(reason);
                this.activeStreams.delete(id);
                cleaned++;
            }
        }
        return cleaned;
    }
}

const streamManager = new StreamManager();
export default streamManager;
