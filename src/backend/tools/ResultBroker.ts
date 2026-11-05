import Log from "../Log";
import type { DeviceToolResult } from "./types";

interface Pending {
    resolve: (result: DeviceToolResult) => void;
    timer: NodeJS.Timeout;
    connectionId: string;
    deviceId?: string;
    signal?: AbortSignal;
    onAbort: () => void;
}

class ResultBroker {
    private pending = new Map<string, Pending>();

    private key(requestId: string, callId: string): string {
        return `${callId}\0${requestId}`;
    }

    wait(
        requestId: string,
        callId: string,
        connectionId: string,
        timeoutMs: number,
        signal?: AbortSignal,
        deviceId?: string,
    ): Promise<DeviceToolResult> {
        const existing = this.pending.get(this.key(requestId, callId));
        if (existing) return Promise.resolve({ success: false, error: "Duplicate result wait" });

        return new Promise<DeviceToolResult>((resolve) => {
            const k = this.key(requestId, callId);
            const onAbort = () => {
                const entry = this.pending.get(k);
                if (entry) {
                    clearTimeout(entry.timer);
                    this.pending.delete(k);
                }
                resolve({ success: false, error: "cancelled", executionTimeMs: 0 });
            };
            const timer = setTimeout(() => {
                this.pending.delete(k);
                if (signal) signal.removeEventListener("abort", onAbort);
                resolve({ success: false, error: "Device did not respond in time", executionTimeMs: 0 });
            }, timeoutMs);

            this.pending.set(k, {
                resolve: (result) => {
                    clearTimeout(timer);
                    this.pending.delete(k);
                    if (signal) signal.removeEventListener("abort", onAbort);
                    resolve(result);
                },
                timer,
                connectionId,
                deviceId,
                signal,
                onAbort,
            });
            if (signal) {
                if (signal.aborted) onAbort();
                else signal.addEventListener("abort", onAbort, { once: true });
            }
        });
    }

    resolve(connectionId: string, requestId: string, callId: string, result: DeviceToolResult, deviceId?: string): boolean {
        const entry = this.pending.get(this.key(requestId, callId));
        if (!entry) return false;
        const idOk = entry.connectionId === connectionId || (entry.deviceId && entry.deviceId === deviceId);
        if (!idOk) {
            Log.warn("Rejected device tool result from wrong device", {
                fromConnectionId: connectionId,
                expectedConnectionId: entry.connectionId,
                fromDeviceId: deviceId,
                expectedDeviceId: entry.deviceId,
                requestId,
            });
            return false;
        }
        entry.resolve(result);
        return true;
    }

    failForDevice(deviceId: string, error: string): void {
        let failed = 0;
        for (const [k, entry] of this.pending) {
            if (entry.deviceId === deviceId) {
                this.pending.delete(k);
                clearTimeout(entry.timer);
                if (entry.signal) entry.signal.removeEventListener("abort", entry.onAbort);
                entry.resolve({ success: false, error, executionTimeMs: 0 });
                failed++;
            }
        }
        if (failed > 0) {
            Log.info("Failed pending device tool results for disconnected device", { deviceId, failed });
        }
    }

    abortRequest(requestId: string): void {
        let aborted = 0;
        for (const [k, entry] of this.pending) {
            if (k.endsWith(`\0${requestId}`)) {
                if (entry.signal) entry.signal.removeEventListener("abort", entry.onAbort);
                entry.resolve({ success: false, error: "cancelled", executionTimeMs: 0 });
                aborted++;
            }
        }
        Log.debug("Result broker aborted request", { requestId, aborted });
    }
}

const resultBroker = new ResultBroker();
export default resultBroker;