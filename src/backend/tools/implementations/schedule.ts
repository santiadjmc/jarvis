import { addTask, listTasks, removeTask } from "../../agent/Scheduler/taskStore";
import { delegateSubagent } from "../../agent/Subagent/subagentRunner";
import { listAgents, getAgent } from "../../agent/Subagent/agentRegistry";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

function serializeTask(t: { id: string; instructions: string; dueAt: number; recurringEveryMs: number | null }) {
    return {
        id: t.id,
        instructions: t.instructions,
        dueAt: new Date(t.dueAt).toISOString(),
        repeatEveryMinutes: t.recurringEveryMs ? t.recurringEveryMs / 60000 : null,
    };
}

const scheduleTask: ToolSpec = {
    name: "schedule_task",
    description: "Schedule something for Jarvis to do or say later, proactively, without the user asking again. When it fires, Jarvis runs it autonomously and pushes the result to every connected device (phone, desktop, etc.), not just the one that scheduled it. Use for reminders, time-based checks, or recurring check-ins.",
    category: "schedule",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            instructions: {
                type: "string",
                description: "What Jarvis should do or say when this fires, written as an instruction to yourself, e.g. 'Remind the user to drink water' or 'Check the weather in Berlin and warn the user if they need an umbrella'.",
            },
            in_minutes: { type: "number", description: "Fire this many minutes from now. Use this or 'at', not both." },
            at: { type: "string", description: "Absolute ISO 8601 datetime to fire at, e.g. 2026-10-06T09:00:00. Use this or 'in_minutes', not both." },
            repeat_every_minutes: { type: "number", description: "If set, repeat every N minutes after the first run (e.g. 1440 for daily)." },
        },
        required: ["instructions"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const instructions = typeof params.instructions === "string" ? params.instructions.trim() : "";
        if (!instructions) return { success: false, data: null, error: "instructions is required" };

        let dueAt: number;
        const inMinutes = Number(params.in_minutes);
        if (Number.isFinite(inMinutes) && params.in_minutes !== undefined) {
            dueAt = Date.now() + Math.max(0, inMinutes) * 60000;
        } else if (typeof params.at === "string" && params.at.trim()) {
            const parsed = Date.parse(params.at);
            if (Number.isNaN(parsed)) return { success: false, data: null, error: `Invalid 'at' datetime: ${params.at}` };
            dueAt = parsed;
        } else {
            return { success: false, data: null, error: "Provide either in_minutes or at" };
        }

        const repeatMinutes = Number(params.repeat_every_minutes);
        const repeatMs = Number.isFinite(repeatMinutes) && repeatMinutes > 0 ? repeatMinutes * 60000 : null;

        const task = addTask(instructions, dueAt, repeatMs);
        return { success: true, data: serializeTask(task) };
    },
};

const listScheduledTasks: ToolSpec = {
    name: "list_scheduled_tasks",
    description: "List all pending scheduled tasks/reminders Jarvis has set up.",
    category: "schedule",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {},
    },
    async execute(_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        return { success: true, data: listTasks().map(serializeTask) };
    },
};

const cancelScheduledTask: ToolSpec = {
    name: "cancel_scheduled_task",
    description: "Cancel a previously scheduled task/reminder by id (see list_scheduled_tasks for ids).",
    category: "schedule",
    requiresApproval: false,
    timeoutMs: 10000,
    parameters: {
        type: "object",
        properties: {
            id: { type: "string", description: "Task id from list_scheduled_tasks" },
        },
        required: ["id"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const id = typeof params.id === "string" ? params.id : "";
        if (!id) return { success: false, data: null, error: "id is required" };
        const removed = removeTask(id);
        return removed
            ? { success: true, data: { id, cancelled: true } }
            : { success: false, data: null, error: `No scheduled task with id ${id}` };
    },
};

const agentPresetList = listAgents().map(a => `${a.id} (${a.name}: ${a.description})`).join("; ");

const delegateTask: ToolSpec = {
    name: "delegate_task",
    description: `Spawn an independent subagent to work on a task in the background, right now, while you keep talking to the user in this conversation instead of waiting. The subagent runs its own tool-calling loop with no memory of this conversation (give it full context in the instructions) and reports its findings directly to the user on every connected device when it finishes. Use this for slower, multi-step, or tangential work you don't want to block your current reply on — e.g. 'research X and report back' while you keep chatting about something else.${agentPresetList ? ` Available specialized agent presets (optional, each overrides the model used): ${agentPresetList}.` : ""}`,
    category: "schedule",
    requiresApproval: false,
    timeoutMs: 5000,
    parameters: {
        type: "object",
        properties: {
            instructions: {
                type: "string",
                description: "A clear, fully self-contained task description for the subagent. It cannot see this conversation, so include everything it needs to know.",
            },
            agent: {
                type: "string",
                description: "Optional id of a specialized agent preset to run this as (see tool description for the list). Omit to use the default model.",
            },
        },
        required: ["instructions"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const instructions = typeof params.instructions === "string" ? params.instructions.trim() : "";
        if (!instructions) return { success: false, data: null, error: "instructions is required" };

        let agentId: string | undefined;
        let agentName: string | undefined;
        let agentDescription: string | undefined;
        let model: string | undefined;
        if (typeof params.agent === "string" && params.agent.trim()) {
            const agent = getAgent(params.agent.trim());
            if (!agent) return { success: false, data: null, error: `Unknown agent preset: ${params.agent}. Use list_agents to see available presets.` };
            agentId = agent.id;
            agentName = agent.name;
            agentDescription = agent.description;
            model = agent.model;
        }

        const taskId = delegateSubagent({ instructions, model, agentId, agentName, agentDescription });
        if (!taskId) return { success: false, data: null, error: "Too many subagents are already running; wait for one to finish first." };
        return { success: true, data: { taskId, agent: agentId ?? null, model: model ?? null, spawned: true, note: "Running in the background now; the result will be delivered to the user when it's done." } };
    },
};

const listAgentsTool: ToolSpec = {
    name: "list_agents",
    description: "List the specialized subagent presets available for delegate_task.",
    category: "schedule",
    requiresApproval: false,
    timeoutMs: 5000,
    parameters: { type: "object", properties: {} },
    async execute(_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        return { success: true, data: listAgents() };
    },
};

const scheduleTools: ToolSpec[] = [scheduleTask, listScheduledTasks, cancelScheduledTask, delegateTask, listAgentsTool];
export default scheduleTools;
