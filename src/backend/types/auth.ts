export interface ApiKey {
    id: string;
    key: string;
    keyHash: string;
    name: string;
    clientId?: string;
    role: ClientRole;
    permissions: Permission[];
    createdAt: number;
    lastUsedAt?: number;
    expiresAt?: number;
    revoked: boolean;
}

export type ClientRole = "user" | "admin" | "service";

export type Permission =
    | "chat:send"
    | "chat:history"
    | "voice:send"
    | "voice:receive"
    | "tools:execute"
    | "config:read"
    | "config:write"
    | "admin:*"
    | "sessions:manage"
    | "models:switch";

export interface JwtPayload {
    sub: string;
    apiKeyId: string;
    role: ClientRole;
    permissions: Permission[];
    iat: number;
    exp: number;
}

export interface AuthResult {
    success: boolean;
    clientId?: string;
    apiKeyId?: string;
    role?: ClientRole;
    permissions?: Permission[];
    error?: string;
}

export interface TokenPair {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
}
