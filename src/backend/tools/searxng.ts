import Log from "../Log";

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

const REQUEST_TIMEOUT_MS = 10000;

function endpoint(): string {
    return (process.env.JARVIS_SEARXNG_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
}

export async function searchSearXNG(query: string, count = 8, categories = "general"): Promise<SearchResult[]> {
    const target = new URL(`${endpoint()}/search`);
    target.searchParams.set("q", query);
    target.searchParams.set("format", "json");
    target.searchParams.set("categories", categories);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(target.toString(), {
            signal: controller.signal,
            headers: { "User-Agent": "Jarvis/1.0 (local assistant)" },
        });
    } catch {
        throw new Error(`SearXNG unreachable at ${endpoint()} - check JARVIS_SEARXNG_URL`);
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        throw new Error(`SearXNG returned HTTP ${response.status}`);
    }

    const payload: any = await response.json().catch(() => null);
    if (!payload || !Array.isArray(payload.results)) {
        Log.warn("SearXNG returned no parseable results", { status: response.status });
        return [];
    }

    return payload.results.slice(0, count).map((r: any) => ({
        title: String(r.title ?? "").trim(),
        url: String(r.url ?? ""),
        snippet: String(r.content ?? r.snippet ?? "").trim(),
    }));
}