import { v4 as uuid } from "uuid";
import crypto from "crypto";
import type { ApiKey, AuthResult, ClientRole, Permission } from "../types/auth";
import Log from "../Log";

class AuthService {
    private apiKeys = new Map<string, ApiKey>();
    private readonly KEY_PREFIX = process.env.API_KEY_PREFIX || "jvs";
    private readonly KEY_LENGTH = 48;

    constructor() {
        this.loadFromEnv();
    }

    private loadFromEnv(): void {
        const masterKey = process.env.JARVIS_MASTER_KEY;
        if (!masterKey) return;
        if (masterKey === "jvs_change_me_this_is_the_admin_key") {
            Log.error("Refusing to load JARVIS_MASTER_KEY: it still has the placeholder value from .env.example. Set a unique secret or remove the variable.");
            return;
        }
        this.registerKey({
            name: "master",
            key: masterKey,
            role: "admin",
            permissions: ["admin:*", "chat:send", "chat:history", "voice:send", "voice:receive", "tools:execute", "config:read", "config:write", "sessions:manage", "models:switch"],
        });
        Log.info("Master API key loaded from environment");
    }

    private registerKey(input: { name: string; key: string; role: ClientRole; permissions: Permission[] }): ApiKey | null {
        const id = uuid();
        const keyHash = this.hashKey(input.key);
        if (this.hasHash(keyHash)) return null;
        const apiKey: ApiKey = {
            id,
            key: input.key,
            keyHash,
            name: input.name,
            role: input.role,
            permissions: input.permissions,
            createdAt: Date.now(),
            revoked: false,
        };
        this.apiKeys.set(id, apiKey);
        return apiKey;
    }

    private hasHash(hash: string): boolean {
        for (const apiKey of this.apiKeys.values()) {
            if (this.hashesEqual(apiKey.keyHash, hash)) return true;
        }
        return false;
    }

    generateKey(name: string, role: ClientRole = "user", permissions: Permission[] = []): ApiKey {
        const id = uuid();
        const rawKey = `${this.KEY_PREFIX}_${crypto.randomBytes(this.KEY_LENGTH).toString("base64url")}`;
        const keyHash = this.hashKey(rawKey);

        if (permissions.length === 0) {
            permissions = this.defaultPermissions(role);
        }

        const apiKey: ApiKey = {
            id,
            key: rawKey,
            keyHash,
            name,
            role,
            permissions,
            createdAt: Date.now(),
            revoked: false,
        };

        this.apiKeys.set(id, apiKey);
        Log.info("API key generated", { keyId: id, name, role });
        return apiKey;
    }

    validateApiKey(key: string): AuthResult {
        const keyHash = this.hashKey(key);

        for (const apiKey of this.apiKeys.values()) {
            if (this.hashesEqual(apiKey.keyHash, keyHash)) {
                if (apiKey.revoked) {
                    return { success: false, error: "API key has been revoked" };
                }
                if (apiKey.expiresAt && Date.now() > apiKey.expiresAt) {
                    return { success: false, error: "API key has expired" };
                }

                apiKey.lastUsedAt = Date.now();

                return {
                    success: true,
                    apiKeyId: apiKey.id,
                    role: apiKey.role,
                    permissions: apiKey.permissions,
                };
            }
        }

        return { success: false, error: "Invalid API key" };
    }

    revokeKey(keyId: string): boolean {
        const apiKey = this.apiKeys.get(keyId);
        if (!apiKey) return false;
        apiKey.revoked = true;
        Log.info("API key revoked", { keyId });
        return true;
    }

    listKeys(): Array<Omit<ApiKey, "key" | "keyHash">> {
        return Array.from(this.apiKeys.values()).map(k => ({
            id: k.id,
            name: k.name,
            role: k.role,
            permissions: k.permissions,
            createdAt: k.createdAt,
            lastUsedAt: k.lastUsedAt,
            expiresAt: k.expiresAt,
            revoked: k.revoked,
        }));
    }

    hasPermission(keyId: string, permission: Permission): boolean {
        const apiKey = this.apiKeys.values();
        for (const k of apiKey) {
            if (k.id === keyId) {
                if (k.revoked) return false;
                if (k.permissions.includes("admin:*")) return true;
                return k.permissions.includes(permission);
            }
        }
        return false;
    }

    private defaultPermissions(role: ClientRole): Permission[] {
        switch (role) {
            case "admin":
                return ["admin:*", "chat:send", "chat:history", "voice:send", "voice:receive", "tools:execute", "config:read", "config:write", "sessions:manage", "models:switch"];
            case "user":
                return ["chat:send", "chat:history", "voice:send", "voice:receive"];
            case "service":
                return ["chat:send", "tools:execute"];
            default:
                return ["chat:send"];
        }
    }

    private hashKey(key: string): string {
        return crypto.createHash("sha256").update(key).digest("hex");
    }

    private hashesEqual(a: string, b: string): boolean {
        const bufA = Buffer.from(a, "hex");
        const bufB = Buffer.from(b, "hex");
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }
}

const authService = new AuthService();
export default authService;
