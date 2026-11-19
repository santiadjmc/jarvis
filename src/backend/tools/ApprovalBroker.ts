import Log from "../Log";

type Acceptor = (action: "approve" | "deny") => void;

/** Who may answer an approval: the requesting connection, or the same device under the same API key. */
export interface ApprovalOwner {
    connectionId: string;
    apiKeyId?: string;
    deviceId?: string;
}

interface PendingApproval {
    resolve: Acceptor;
    timer: NodeJS.Timeout;
    owner: ApprovalOwner;
    signal?: AbortSignal;
    onAbort: () => void;
}

export type ApprovalResult = "approve" | "deny" | "timeout" | "aborted";
/** Same meaning as ResultDelivery in ResultBroker. */
export type ApprovalDelivery = "accepted" | "duplicate" | "rejected" | "unknown";

const SETTLED_TTL_MS = 10 * 60_000;
const SETTLED_MAX = 5_000;

class ApprovalBroker {
    private pending = new Map<string, PendingApproval>();
    private settled = new Map<string, number>();

    private key(requestId: string, callId: string): string {
        return `${callId}\0${requestId}`;
    }

    private markSettled(k: string): void {
        const now = Date.now();
        this.settled.delete(k);
        this.settled.set(k, now + SETTLED_TTL_MS);
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

    wait(requestId: string, callId: string, timeoutMs: number, signal?: AbortSignal, owner: ApprovalOwner | string = ""): Promise<ApprovalResult> {
        const existing = this.pending.get(this.key(requestId, callId));
        if (existing) return Promise.resolve("timeout");
        const boundOwner: ApprovalOwner = typeof owner === "string" ? { connectionId: owner } : owner;

        return new Promise<ApprovalResult>((resolve) => {
            const k = this.key(requestId, callId);
            this.settled.delete(k);
            const settle = (result: ApprovalResult) => {
                const entry = this.pending.get(k);
                if (entry) {
                    clearTimeout(entry.timer);
                    this.pending.delete(k);
                }
                if (signal) signal.removeEventListener("abort", onAbort);
                this.markSettled(k);
                resolve(result);
            };
            const onAbort = () => settle("aborted");
            const timer = setTimeout(() => settle("timeout"), timeoutMs);

            this.pending.set(k, {
                resolve: settle,
                timer,
                owner: boundOwner,
                signal,
                onAbort,
            });
            if (signal) {
                if (signal.aborted) onAbort();
                else signal.addEventListener("abort", onAbort, { once: true });
            }
        });
    }

    /**
     * Delivers an approval decision. The first answer wins; re-sends (e.g. queued by
     * the app across a reconnect) are ignored as duplicates. clientId undefined skips
     * the ownership check (internal callers only).
     */
    resolve(requestId: string, callId: string, action: "approve" | "deny", clientId?: string, apiKeyId?: string, deviceId?: string): ApprovalDelivery {
        const k = this.key(requestId, callId);
        const entry = this.pending.get(k);
        if (!entry) {
            if (this.isSettled(k)) {
                Log.debug("Ignoring duplicate approval response", { requestId, callId, clientId });
                return "duplicate";
            }
            return "unknown";
        }
        if (clientId !== undefined) {
            const { owner } = entry;
            const keyOk = owner.apiKeyId === undefined || owner.apiKeyId === apiKeyId;
            const sameDevice = !!owner.deviceId && owner.deviceId === deviceId;
            if (!(keyOk && (owner.connectionId === clientId || sameDevice))) {
                Log.warn("Rejected approval from a client that does not own the request", { requestId, callId, clientId });
                return "rejected";
            }
        }
        entry.resolve(action);
        return "accepted";
    }

    abortRequest(requestId: string): void {
        let aborted = 0;
        for (const [k, entry] of [...this.pending]) {
            if (k.endsWith(`\0${requestId}`)) {
                entry.resolve("deny");
                aborted++;
            }
        }
        Log.debug("Approval broker aborted request", { requestId, aborted });
    }
}

const approvalBroker = new ApprovalBroker();
export default approvalBroker;
