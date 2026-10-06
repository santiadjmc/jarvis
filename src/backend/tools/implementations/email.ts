import { createTransport } from "nodemailer";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

function smtpConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function buildTransport() {
    return createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
}

const sendEmail: ToolSpec = {
    name: "send_email",
    description: "Send an email on the user's behalf via the configured SMTP account. Requires user approval.",
    category: "communication",
    requiresApproval: true,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            to: { type: "string", description: "Recipient email address, or comma-separated addresses" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Plain-text email body" },
        },
        required: ["to", "subject", "body"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        if (!smtpConfigured()) {
            return { success: false, data: null, error: "SMTP is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS in .env)" };
        }
        const to = typeof params.to === "string" ? params.to.trim() : "";
        const subject = typeof params.subject === "string" ? params.subject : "";
        const body = typeof params.body === "string" ? params.body : "";
        if (!to) return { success: false, data: null, error: "to is required" };
        try {
            const transport = buildTransport();
            const info = await transport.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to,
                subject,
                text: body,
            });
            return { success: true, data: { to, subject, messageId: info.messageId } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const emailTools: ToolSpec[] = [sendEmail];
export default emailTools;
