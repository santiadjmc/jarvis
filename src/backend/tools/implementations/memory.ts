import { addMemory, searchMemory, memoryCount } from "../../agent/Memory/memoryStore";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const remember: ToolSpec = {
    name: "remember",
    description: "Store a fact or note in long-term memory so Jarvis can recall it in future conversations.",
    category: "memory",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            fact: { type: "string", description: "The fact or note to remember" },
        },
        required: ["fact"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const fact = typeof params.fact === "string" ? params.fact.trim() : "";
        if (!fact) return { success: false, data: null, error: "fact is required" };
        try {
            const id = await addMemory(fact);
            return { success: true, data: { id, stored: fact, total: memoryCount() } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const recall: ToolSpec = {
    name: "recall",
    description: "Search long-term memory for facts related to a query and return the most relevant entries.",
    category: "memory",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "What to look up, e.g. 'what did the user say about the server'" },
            count: { type: "number", description: "Max results (default 5)", default: 5 },
        },
        required: ["query"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (!query) return { success: false, data: null, error: "query is required" };
        const count = Math.max(1, Math.min(10, Number(params.count ?? 5)));
        try {
            const results = await searchMemory(query, count);
            return { success: true, data: { query, results } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const memoryTools: ToolSpec[] = [remember, recall];
export default memoryTools;