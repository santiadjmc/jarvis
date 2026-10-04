import modelManager from "./ModelManager";
import ollamaClient from "./OllamaClient";
import Log from "../Log";

export type RouteTier = "fast" | "deep";

interface RouteResult {
    model: string;
    tier: RouteTier;
}

const CLASSIFIER_SYSTEM_PROMPT = `You are the routing classifier for Jarvis. Based ONLY on whether answering the user query requires deep multi-step reasoning, reply with exactly YES or NO.
Deep tasks: math proofs and nontrivial computation, algorithm or complex code work, logical deduction chains, long-form analysis or synthesis.
Simple tasks: quick facts, greetings, short explanations, simple arithmetic (like 2+2 or 17x23), anything answerable briefly.
Examples:
Query: "What is the capital of France?" -> NO
Query: "Prove that sqrt(2) is irrational and show the contradiction" -> YES
Query: "Write a Python function to reverse a linked list and analyze its complexity" -> YES
Query: "Tell me a joke." -> NO
Query: "The square root of 2 is irrational, please prove it in simple steps." -> YES
Now answer only YES or NO for the query below.`;

const DEEP_PATTERNS: RegExp[] = [
    /(^|\s)(prove|proof|derive|derivation)\b/i,
    /(^|\s)(calculate|compute|solve|evaluate)\b/i,
    /(^|\s)(equation|formula|algebra|calculus|integral|differentiat|logarithm)\b/i,
    /[0-9](\s*[+\-*/^×÷]\s*[0-9])+/,
    /(^|\s)(refactor|debug|optimize|optimise|architect|architecture|code review)\b/i,
    /(^|\s)(algorithm|data structure|function signature|implement a|design a)\b/i,
    /(^|\s)(compare|contrast|analyze|analyse|synthesize|synthesise|evaluate)\b/i,
    /(^|\s)(plan|planning|strategy|roadmap|workflow|step-by-step)\b/i,
];

class ModelRouter {
    async route(content: string, requestedModel?: string): Promise<RouteResult> {
        if (requestedModel) {
            return { model: requestedModel, tier: requestedModel === modelManager.getDeep() ? "deep" : "fast" };
        }

        const routingMode = (process.env.JARVIS_ROUTING || "auto").toLowerCase();
        if (routingMode === "always_fast") return { model: modelManager.getActive(), tier: "fast" };
        if (routingMode === "always_deep") return { model: modelManager.getDeep(), tier: "deep" };

        const text = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (text.split(" ").length < 4) return { model: modelManager.getActive(), tier: "fast" };

        const startedAt = Date.now();
        const classified = await this.classifyWithFastModel(text);
        const classifyMs = Date.now() - startedAt;

        if (classified === false) {
            this.logRoute(text, { model: modelManager.getActive(), tier: "fast" }, classifyMs, "classifier");
            return { model: modelManager.getActive(), tier: "fast" };
        }
        if (classified === true) {
            this.logRoute(text, { model: modelManager.getDeep(), tier: "deep" }, classifyMs, "classifier");
            return { model: modelManager.getDeep(), tier: "deep" };
        }

        for (const pattern of DEEP_PATTERNS) {
            if (pattern.test(text)) {
                this.logRoute(text, { model: modelManager.getDeep(), tier: "deep" }, classifyMs, "pattern-fallback");
                return { model: modelManager.getDeep(), tier: "deep" };
            }
        }

        this.logRoute(text, { model: modelManager.getActive(), tier: "fast" }, classifyMs, "default");
        return { model: modelManager.getActive(), tier: "fast" };
    }

    private async classifyWithFastModel(content: string): Promise<boolean | null> {
        const fast = modelManager.getActive();
        try {
            const reply = await ollamaClient.chat({
                model: fast,
                messages: [
                    { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
                    { role: "user", content },
                ],
                options: { num_predict: 16, temperature: 0 },
                keepAlive: -1,
            });
            const normalized = reply.trim().toUpperCase();
            if (normalized.startsWith("YES")) return true;
            if (normalized.startsWith("NO")) return false;
            return null;
        } catch {
            return null;
        }
    }

    private logRoute(content: string, result: RouteResult, classifyMs: number, source: string): void {
        Log.debug("Model routing decision", {
            tier: result.tier,
            model: result.model,
            source,
            classifyMs,
            snippet: content.slice(0, 80),
        });
    }
}

const modelRouter = new ModelRouter();
export default modelRouter;