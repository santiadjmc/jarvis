import Log from "../../Log";

export interface DeviceInfo {
    deviceId: string;
    deviceName: string;
    deviceType: string;
    capabilities: string[];
}

interface DeviceEntry {
    deviceId: string;
    deviceName: string;
    deviceType: string;
    capabilities: Set<string>;
    connectionId: string;
    connectedAt: number;
    lastSeen: number;
}

class DeviceRegistry {
    private devices = new Map<string, DeviceEntry>();
    private byConnection = new Map<string, string>();

    upsert(connectionId: string, info: DeviceInfo): void {
        const now = Date.now();
        const existingConnection = this.byConnection.get(connectionId);
        if (existingConnection && existingConnection !== info.deviceId) {
            const old = this.devices.get(existingConnection);
            if (old && old.connectionId === connectionId) {
                this.devices.delete(existingConnection);
                Log.info("Device re-identified, old entry removed", { oldDeviceId: existingConnection });
            }
        }

        const existing = this.devices.get(info.deviceId);
        if (existing && existing.connectionId !== connectionId) {
            this.byConnection.delete(existing.connectionId);
            Log.info("Device reconnected, replacing stale connection", {
                deviceId: info.deviceId,
                newConnectionId: connectionId,
            });
        }

        const entry: DeviceEntry = {
            deviceId: info.deviceId,
            deviceName: info.deviceName || info.deviceId.slice(0, 8),
            deviceType: info.deviceType || "unknown",
            capabilities: new Set(info.capabilities || []),
            connectionId,
            connectedAt: existing?.connectedAt ?? now,
            lastSeen: now,
        };
        this.devices.set(info.deviceId, entry);
        this.byConnection.set(connectionId, info.deviceId);

        Log.debug("Device registered", {
            deviceId: entry.deviceId,
            deviceName: entry.deviceName,
            deviceType: entry.deviceType,
            capabilities: entry.capabilities.size,
        });
    }

    touch(connectionId: string): void {
        const deviceId = this.byConnection.get(connectionId);
        if (!deviceId) return;
        const entry = this.devices.get(deviceId);
        if (entry) entry.lastSeen = Date.now();
    }

    onClientDisconnect(connectionId: string): string | undefined {
        const deviceId = this.byConnection.get(connectionId);
        if (!deviceId) return undefined;
        const entry = this.devices.get(deviceId);
        if (entry && entry.connectionId === connectionId) {
            this.devices.delete(deviceId);
            Log.info("Device went offline", { deviceId, deviceName: entry.deviceName });
        }
        this.byConnection.delete(connectionId);
        return deviceId;
    }

    hasCapability(capability?: string): boolean {
        if (!capability) return false;
        for (const entry of this.devices.values()) {
            if (entry.capabilities.has(capability)) return true;
        }
        return false;
    }

    connectionHasCapability(connectionId: string, capability?: string): boolean {
        if (!capability) return false;
        const deviceId = this.byConnection.get(connectionId);
        return !!deviceId && this.devices.get(deviceId)?.capabilities.has(capability) === true;
    }

    resolveConnection(target?: string, fallbackDeviceId?: string): string | undefined {
        if (target) {
            const byId = this.devices.get(target);
            if (byId) return byId.connectionId;
            const lower = target.toLowerCase();
            for (const entry of this.devices.values()) {
                if (entry.deviceName.toLowerCase() === lower) return entry.connectionId;
            }
            for (const entry of this.devices.values()) {
                if (entry.deviceName.toLowerCase().includes(lower)) return entry.connectionId;
            }
            return undefined;
        }
        if (fallbackDeviceId) {
            const entry = this.devices.get(fallbackDeviceId);
            if (entry) return entry.connectionId;
        }
        const first = this.devices.values().next();
        return first.done ? undefined : first.value.connectionId;
    }

    getDeviceId(connectionId: string): string | undefined {
        return this.byConnection.get(connectionId);
    }

    resolveName(connectionId: string): string {
        const deviceId = this.byConnection.get(connectionId);
        if (!deviceId) return "device";
        return this.devices.get(deviceId)?.deviceName || deviceId.slice(0, 8);
    }

    list(): Array<{ id: string; name: string; type: string; capabilities: string[]; online: boolean; connectedAt: number }> {
        return Array.from(this.devices.values())
            .sort((a, b) => a.deviceName.localeCompare(b.deviceName))
            .map(e => ({
                id: e.deviceId,
                name: e.deviceName,
                type: e.deviceType,
                capabilities: Array.from(e.capabilities),
                online: true,
                connectedAt: e.connectedAt,
            }));
    }

    listForModel(): Array<{ id: string; name: string; type: string; tools: string[] }> {
        return Array.from(this.devices.values())
            .sort((a, b) => a.deviceName.localeCompare(b.deviceName))
            .map(e => ({
                id: e.deviceId,
                name: e.deviceName,
                type: e.deviceType,
                tools: Array.from(e.capabilities),
            }));
    }
}

const deviceRegistry = new DeviceRegistry();
export default deviceRegistry;
