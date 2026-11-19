import Log from "../Log";
import type { DeviceToolResult } from "./types";

interface Pending {
    resolve: (result: DeviceToolResult) => void;
    timer: NodeJS.Timeout;
    graceTimer?: NodeJS.Timeout;
    connectionId: string;
    deviceId?: string;
    ownerKeyId?: string;
    signal?: AbortSignal;
    onAbort: () => void;
}

/**
 * Outcome of delivering a device tool result:
 * - accepted: first result for a pending (requestId, callId); the waiter was resolved.
 * - duplicate: the call was already settled (result, timeout, cancel). Ignore quietly;
 *   the app may re-send queued results after a reconnect.
 * - rejected: the call is pending but the sender is not the bound device/key.
 * - unknown: never seen (or settled long enough ago to be forgotten).
 */
export type ResultDelivery = "accepted" | "duplicate" | "rejected" | "unknown";

/** How long a disconnected device has to reconnect and re-send a queued result. */
export const DISCONNECT_GRACE_MS = 15_000;
/** How long settled call keys are remembered so late re-sends are recognised as duplicates. */
const SETTLED_TTL_MS = 10 * 60_000;
const SETTLED_MAX = 5_000;

class ResultBroker {
    private pending = new Map<string, Pending>();
    private settled = new Map<string, number>();

    private key(requestId: string, callId: string): string {
        return `${callId}\0${requestId}`;
    }

    private markSettled(k: string): void {
        const now = Date.now();
        this.settled.delete(k);
        this.settled.set(k, now + SETTLED_TTL_MS);
        // Insertion-ordered: evict expired entries (and the oldest ones beyond the cap).
        for (const [key, expires] of this.settled) {
            if (expires > now && this.settled.size <= SETTLED_MAX) break;
            this.settled.delete(key);
        }
    }

    private isSettled(k: string): boolean {
        const expires = this.settled.get(k);
        if (expires === undefined) return false;
        if (expires <= Date.now()) {
            this.settled.delete(k);
            return false;
        }
        return true;
    }

    wait(
        requestId: string,
        callId: string,
        connectionId: string,
        timeoutMs: number,
        signal?: AbortSignal,
        deviceId?: string,
        ownerKeyId?: string,
    ): Promise<DeviceToolResult> {
        const existing = this.pending.get(this.key(requestId, callId));
        if (existing) return Promise.resolve({ success: false, error: "Duplicate result wait" });

        return new Promise<DeviceToolResult>((resolve) => {
            const k = this.key(requestId, callId);
            this.settled.delete(k);
            const settle = (result: DeviceToolResult) => {
                const entry = this.pending.get(k);
                if (entry) {
                    clearTimeout(entry.timer);
                    if (entry.graceTimer) clearTimeout(entry.graceTimer);
                    this.pending.delete(k);
                }
                if (signal) signal.removeEventListener("abort", onAbort);
                this.markSettled(k);
                resolve(result);
            };
            const onAbort = () => settle({ success: false, error: "cancelled", executionTimeMs: 0 });
            const timer = setTimeout(() => {
                settle({ success: false, error: "Device did not respond in time", executionTimeMs: 0 });
            }, timeoutMs);

            this.pending.set(k, {
                resolve: settle,
                timer,
                connectionId,
                deviceId,
                ownerKeyId,
                signal,
                onAbort,
            });
            if (signal) {
                if (signal.aborted) onAbort();
                else signal.addEventListener("abort", onAbort, { once: true });
            }
        });
    }

    resolve(connectionId: string, requestId: string, callId: string, result: DeviceToolResult, deviceId?: string, apiKeyId?: string): ResultDelivery {
        const k = this.key(requestId, callId);
        const entry = this.pending.get(k);
        if (!entry) {
            if (this.isSettled(k)) {
                Log.debug("Ignoring duplicate device tool result", { connectionId, requestId, callId });
                return "duplicate";
            }
            return "unknown";
        }
        // A result is only accepted from the connection we dispatched to, or from the
        // same deviceId reconnected under the same API key (never a spoofed deviceId).
        // The connection id alone may change across reconnects; the key binding may not.
        const keyOk = entry.ownerKeyId === undefined || entry.ownerKeyId === apiKeyId;
        const idOk = keyOk && (entry.connectionId === connectionId || (!!entry.deviceId && entry.deviceId === deviceId));
        if (!idOk) {
            Log.warn("Rejected device tool result from wrong device", {
                fromConnectionId: connectionId,
                expectedConnectionId: entry.connectionId,
                fromDeviceId: deviceId,
                expectedDeviceId: entry.deviceId,
                requestId,
            });
            return "rejected";
        }
        entry.resolve(result);
        return "accepted";
    }

    /**
     * Called when a device's connection drops. Pending calls are failed after a
     * short grace period so a reconnecting device can still deliver queued results;
     * graceMs <= 0 fails them immediately.
     */
    failForDevice(deviceId: string, error: string, graceMs = DISCONNECT_GRACE_MS): void {
        let affected = 0;
        for (const entry of [...this.pending.values()]) {
            if (entry.deviceId !== deviceId) continue;
            affected++;
            const fail = () => entry.resolve({ success: false, error, executionTimeMs: 0 });
            if (graceMs <= 0) fail();
            else if (!entry.graceTimer) entry.graceTimer = setTimeout(fail, graceMs);
        }
        if (affected > 0) {
            Log.info("Device disconnected with pending tool results", { deviceId, pending: affected, graceMs });
        }
    }

    /**
     * Called when a device says hello again. Its pending calls stop counting down
     * the disconnect grace period; they still have their normal timeout, and the
     * device can deliver the result from the new connection.
     */
    deviceReconnected(deviceId: string, apiKeyId?: string): number {
        let resumed = 0;
        for (const entry of this.pending.values()) {
            if (entry.deviceId !== deviceId || !entry.graceTimer) continue;
            if (entry.ownerKeyId !== undefined && entry.ownerKeyId !== apiKeyId) continue;
            clearTimeout(entry.graceTimer);
            entry.graceTimer = undefined;
            resumed++;
        }
        if (resumed > 0) Log.info("Device reconnected with pending tool results", { deviceId, pending: resumed });
        return resumed;
    }

    abortRequest(requestId: string): void {
        let aborted = 0;
        for (const [k, entry] of [...this.pending]) {
            if (k.endsWith(`\0${requestId}`)) {
                entry.resolve({ success: false, error: "cancelled", executionTimeMs: 0 });
                aborted++;
            }
        }
        Log.debug("Result broker aborted request", { requestId, aborted });
    }
}

const resultBroker = new ResultBroker();
export default resultBroker;
