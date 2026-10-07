export interface SubagentRequest {
    instructions: string;
    model?: string;
    agentId?: string;
    agentName?: string;
    agentDescription?: string;
}

type Runner = (req: SubagentRequest) => string | null;

let runner: Runner | null = null;

export function registerSubagentRunner(fn: Runner): void {
    runner = fn;
}

export function delegateSubagent(req: SubagentRequest): string | null {
    if (!runner) throw new Error("Subagent runner not initialized yet");
    return runner(req);
}
