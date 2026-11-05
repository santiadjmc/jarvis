import type { ToolContext, ToolResult, ToolSpec } from "../types";

const ALLOWED_TOKEN = /\s+|Math\.(?:min|max|abs|round|floor|ceil|sqrt|pow|sin|cos|tan|log|exp|PI|E)|\d+(?:\.\d+)?|[+\-*/(),]/y;

function hasOnlyAllowedTokens(expression: string): boolean {
    let index = 0;
    while (index < expression.length) {
        ALLOWED_TOKEN.lastIndex = index;
        const match = ALLOWED_TOKEN.exec(expression);
        if (!match) return false;
        index = ALLOWED_TOKEN.lastIndex;
    }
    return true;
}

function safeEvaluate(expression: string): number {
    const sanitized = expression
        .replace(/\bmin\b/g, "Math.min")
        .replace(/\bmax\b/g, "Math.max")
        .replace(/\babs\b/g, "Math.abs")
        .replace(/\bround\b/g, "Math.round")
        .replace(/\bfloor\b/g, "Math.floor")
        .replace(/\bceil\b/g, "Math.ceil")
        .replace(/\bsqrt\b/g, "Math.sqrt")
        .replace(/\bpow\b/g, "Math.pow")
        .replace(/\bsin\b/g, "Math.sin")
        .replace(/\bcos\b/g, "Math.cos")
        .replace(/\btan\b/g, "Math.tan")
        .replace(/\blog\b/g, "Math.log")
        .replace(/\bexp\b/g, "Math.exp")
        .replace(/\bPI\b/g, "Math.PI")
        .replace(/\bE\b/g, "Math.E");

    if (!hasOnlyAllowedTokens(sanitized)) {
        throw new Error("Expression contains characters that are not allowed. Only numbers, + - * / ( ) , and the functions min/max/abs/round/floor/ceil/sqrt/pow/sin/cos/tan/log/exp/PI/E are permitted.");
    }

    const fn = new Function(`"use strict"; return (${sanitized});`);
    const result = fn();
    if (typeof result !== "number" || !Number.isFinite(result)) {
        throw new Error("Expression did not evaluate to a finite number");
    }
    return result;
}

const calculate: ToolSpec = {
    name: "calculate",
    description: "Evaluate a math expression precisely. Use this instead of doing arithmetic yourself whenever exact numbers matter. Supports + - * / ( ) and functions: min, max, abs, round, floor, ceil, sqrt, pow, sin, cos, tan, log, exp, PI, E.",
    category: "utility",
    requiresApproval: false,
    timeoutMs: 5000,
    parameters: {
        type: "object",
        properties: {
            expression: { type: "string", description: "Math expression, e.g. '(12 + 8) * 3 / sqrt(4)'" },
        },
        required: ["expression"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const expression = typeof params.expression === "string" ? params.expression.trim() : "";
        if (!expression) return { success: false, data: null, error: "expression is required" };
        try {
            const result = safeEvaluate(expression);
            return { success: true, data: { expression, result } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const codeTools: ToolSpec[] = [calculate];
export default codeTools;
