import Log from "../Log";

type Acceptor = (action: "approve" | "deny") => void;

interface PendingApproval {
    resolve: Acceptor;
    timer: NodeJS.Timeout;
    ownerId: string;
    signal?: AbortSignal;
    onAbort: () => void;
}

export type ApprovalResult = "approve" | "deny" | "timeout" | "aborted";

class ApprovalBroker {
    private pending = new Map<string, PendingApproval>();

    private key(requestId: string, callId: string): string {
        return `${callId}\0${requestId}`;
    }

    wait(requestId: string, callId: string, timeoutMs: number, signal?: AbortSignal, ownerId = ""): Promise<ApprovalResult> {
        const existing = this.pending.get(this.key(requestId, callId));
        if (existing) return Promise.resolve("timeout");

        return new Promise<ApprovalResult>((resolve) => {
            const k = this.key(requestId, callId);
            const onAbort = () => {
                const entry = this.pending.get(k);
                if (entry) {
                    clearTimeout(entry.timer);
                    this.pending.delete(k);
                }
                resolve("aborted");
            };
            const timer = setTimeout(() => {
                this.pending.delete(k);
                if (signal) signal.removeEventListener("abort", onAbort);
                resolve("timeout");
            }, timeoutMs);

            this.pending.set(k, {
                resolve: (action) => {
                    clearTimeout(timer);
                    this.pending.delete(k);
                    if (signal) signal.removeEventListener("abort", onAbort);
                    resolve(action);
                },
                timer,
                ownerId,
                signal,
                onAbort,
            });
            if (signal) {
                if (signal.aborted) onAbort();
                else signal.addEventListener("abort", onAbort, { once: true });
            }
        });
    }

    resolve(requestId: string, callId: string, action: "approve" | "deny", clientId?: string): boolean {
        const entry = this.pending.get(this.key(requestId, callId));
        if (!entry) return false;
        if (clientId !== undefined && entry.ownerId !== clientId) {
            Log.warn("Rejected approval from a client that does not own the request", { requestId, callId, clientId });
            return false;
        }
        entry.resolve(action);
        return true;
    }

    abortRequest(requestId: string): void {
        let aborted = 0;
        for (const [k, entry] of this.pending) {
            if (k.endsWith(`\0${requestId}`)) {
                if (entry.signal) entry.signal.removeEventListener("abort", entry.onAbort);
                entry.resolve("deny");
                aborted++;
            }
        }
        Log.debug("Approval broker aborted request", { requestId, aborted });
    }
}

const approvalBroker = new ApprovalBroker();
export default approvalBroker;