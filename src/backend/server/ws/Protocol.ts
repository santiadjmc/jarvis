import { z } from "zod";

export const ChatMessageSchema = z.object({
    type: z.literal("chat"),
    id: z.string().uuid(),
    content: z.string().min(1).max(32000),
    sessionId: z.string().optional(),
    model: z.string().optional(),
    systemPrompt: z.string().max(8000).optional(),
    stream: z.boolean().optional().default(true),
    voice: z.boolean().optional().default(false),
    timestamp: z.number(),
});

export const VoiceMessageSchema = z.object({
    type: z.literal("voice"),
    id: z.string().uuid(),
    sessionId: z.string().optional(),
    model: z.string().optional(),
    timestamp: z.number(),
});

export const ToolResponseMessageSchema = z.object({
    type: z.literal("tool_response"),
    id: z.string().uuid(),
    requestId: z.string(),
    callId: z.string(),
    action: z.enum(["approve", "deny"]),
    data: z.unknown().optional(),
});

export const DeviceHelloMessageSchema = z.object({
    type: z.literal("device_hello"),
    id: z.string().uuid(),
    deviceId: z.string().min(1).max(128),
    deviceName: z.string().max(80).optional(),
    deviceType: z.string().max(32).optional(),
    capabilities: z.array(z.string().max(64)).max(64).optional(),
});

export const ToolExecuteResultMessageSchema = z.object({
    type: z.literal("tool_execute_result"),
    id: z.string().uuid(),
    requestId: z.string(),
    callId: z.string(),
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().max(4000).optional(),
    executionTimeMs: z.number().nonnegative().optional(),
});

export const SpeakMessageSchema = z.object({
    type: z.literal("speak"),
    id: z.string().uuid(),
    text: z.string().min(1).max(4000),
    timestamp: z.number().optional(),
});

export const CancelMessageSchema = z.object({
    type: z.literal("cancel"),
    id: z.string().uuid(),
    requestId: z.string(),
});

export const PingMessageSchema = z.object({
    type: z.literal("ping"),
    id: z.string().uuid(),
    timestamp: z.number(),
});

export const ConfigMessageSchema = z.object({
    type: z.literal("config"),
    id: z.string().uuid(),
    action: z.enum(["get", "set"]),
    key: z.string(),
    value: z.unknown().optional(),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
    ChatMessageSchema,
    VoiceMessageSchema,
    ToolResponseMessageSchema,
    DeviceHelloMessageSchema,
    ToolExecuteResultMessageSchema,
    SpeakMessageSchema,
    CancelMessageSchema,
    PingMessageSchema,
    ConfigMessageSchema,
]);

export type ValidatedClientMessage = z.infer<typeof ClientMessageSchema>;

export function validateMessage(raw: unknown): { success: true; data: ValidatedClientMessage } | { success: false; error: string } {
    const result = ClientMessageSchema.safeParse(raw);
    if (result.success) return { success: true, data: result.data };
    const issues = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { success: false, error: issues };
}
