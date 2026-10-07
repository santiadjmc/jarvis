import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import Log from "../../Log";

export interface SubagentDefinition {
    id: string;
    name: string;
    description: string;
    model: string;
}

const BUNDLED_AGENTS_PATH = join(__dirname, "agents.json");

function userAgentsPath(): string {
    return join(process.env.JARVIS_DATA_DIR || join(homedir(), ".local", "share", "jarvis"), "agents.json");
}

function loadFrom(path: string): SubagentDefinition[] {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const agents = Array.isArray(raw.agents) ? raw.agents : [];
    return agents.filter((a: any): a is SubagentDefinition =>
        a && typeof a.id === "string" && typeof a.name === "string" && typeof a.description === "string" && typeof a.model === "string");
}

function load(): SubagentDefinition[] {
    const path = existsSync(userAgentsPath()) ? userAgentsPath() : BUNDLED_AGENTS_PATH;
    try {
        return loadFrom(path);
    } catch (err: any) {
        Log.warn("Failed to load agents.json, no subagent presets available", { path, error: err.message });
        return [];
    }
}

let cache: SubagentDefinition[] | null = null;

export function listAgents(): SubagentDefinition[] {
    if (!cache) cache = load();
    return cache;
}

export function getAgent(id: string): SubagentDefinition | undefined {
    return listAgents().find(a => a.id.toLowerCase() === id.toLowerCase());
}
