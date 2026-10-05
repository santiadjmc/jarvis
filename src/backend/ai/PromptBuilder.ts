import type { OllamaMessage, OllamaTool, OllamaToolCall } from "../types/ai";

interface BuildableMessage {
    role: string;
    content: string;
    tool_name?: string;
    tool_call_id?: string;
    toolCalls?: OllamaToolCall[];
}

class PromptBuilder {
    private defaultSystemPrompt = `You are Jarvis, a highly capable AI assistant.
You are helpful, concise, and direct. Be precise; if you don't know something, say so.
You do not request permission, confirmation, or clarification before taking helpful actions.
When a task requires it, just do it.`;

    buildChatMessages(conversationMessages: BuildableMessage[], systemPrompt?: string): OllamaMessage[] {
        const messages: OllamaMessage[] = [];

        if (systemPrompt) {
            messages.push({ role: "system", content: systemPrompt });
        } else {
            messages.push({ role: "system", content: this.defaultSystemPrompt });
        }

        for (const msg of conversationMessages) {
            if (msg.role === "system" && messages.length > 0 && messages[0].role === "system") {
                continue;
            }
            const entry: OllamaMessage = {
                role: msg.role as "system" | "user" | "assistant" | "tool",
                content: msg.content,
            };
            if (msg.role === "assistant" && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
                entry.tool_calls = msg.toolCalls;
            }
            if (msg.role === "tool" && msg.tool_name) {
                entry.tool_name = msg.tool_name;
            }
            if (msg.role === "tool" && msg.tool_call_id) {
                entry.tool_call_id = msg.tool_call_id;
            }
            messages.push(entry);
        }

        return messages;
    }

    buildAgentMessages(conversationMessages: BuildableMessage[], tools: OllamaTool[], systemPrompt?: string): OllamaMessage[] {
        const agentSystem = `${systemPrompt || this.defaultSystemPrompt}

You have access to the tools listed below.

Rules:
- Decide yourself when a tool is needed and call it directly. Do NOT ask the user for permission or confirmation before calling a tool; approval and denial are handled automatically outside the conversation.
- Call tools sequentially as needed to complete the task, then answer using their results.
- If a tool fails, report the error honestly and move on.

Available tools:
${tools.map(t => `- ${t.function.name}: ${t.function.description}`).join("\n")}`;

        return this.buildChatMessages(conversationMessages, agentSystem);
    }

    buildEmbeddingText(text: string, maxLength: number = 8000): string {
        return text.slice(0, maxLength).trim();
    }

    buildMemoryQuery(text: string): string {
        return `Search for relevant information about: ${text}`;
    }

    buildSummaryPrompt(messages: { role: string; content: string }[]): string {
        const conversation = messages
            .filter(m => m.role !== "system")
            .map(m => `${m.role}: ${m.content}`)
            .join("\n");

        return `Summarize the following conversation concisely, keeping key facts and context:

${conversation}

Summary:`;
    }

    setDefaultSystemPrompt(prompt: string): void {
        this.defaultSystemPrompt = prompt;
    }

    getDefaultSystemPrompt(): string {
        return this.defaultSystemPrompt;
    }
}

const promptBuilder = new PromptBuilder();
export default promptBuilder;