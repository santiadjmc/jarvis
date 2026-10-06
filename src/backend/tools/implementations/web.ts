import { searchSearXNG } from "../searxng";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const MAX_FETCH_BYTES = 262144;
const FETCH_TIMEOUT_MS = 15000;

const webSearch: ToolSpec = {
    name: "web_search",
    description: "Search the web via SearXNG and return the top results (title, URL, snippet).",
    category: "web",
    requiresApproval: false,
    timeoutMs: 15000,
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query" },
            count: { type: "number", description: "Number of results, max 8 (default 8)", default: 8 },
        },
        required: ["query"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const query = typeof params.query === "string" ? params.query : "";
        if (!query.trim()) return { success: false, data: null, error: "query is required" };
        const count = Math.max(1, Math.min(8, Number(params.count ?? 8)));
        try {
            const results = await searchSearXNG(query.trim(), count);
            return { success: true, data: { query, results } };
        } catch (err: any) {
            return { success: false, data: null, error: err.message };
        }
    },
};

const fetchUrl: ToolSpec = {
    name: "fetch_url",
    description: "Download a web page/URL and return its visible text (truncated to 256KB).",
    category: "web",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            url: { type: "string", description: "Absolute http(s) URL to fetch" },
        },
        required: ["url"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const url = typeof params.url === "string" ? params.url : "";
        if (!/^https?:\/\//i.test(url)) return { success: false, data: null, error: "Only http(s) URLs are supported" };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                redirect: "follow",
                headers: { "User-Agent": "Mozilla/5.0 Jarvis/1.0 (local assistant)" },
            });
            if (!response.ok) {
                return { success: false, data: null, error: `HTTP ${response.status} ${response.statusText}` };
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const truncated = buffer.length > MAX_FETCH_BYTES;
            const bytes = truncated ? buffer.subarray(0, MAX_FETCH_BYTES) : buffer;
            const decoded = bytes.toString("utf-8");
            const stripped = stripMarkup(decoded, response.headers.get("content-type") || "");
            return {
                success: true,
                data: {
                    url: response.url || url,
                    contentType: response.headers.get("content-type") || "",
                    bytes: buffer.length,
                    truncated,
                    content: stripped.length > MAX_FETCH_BYTES ? stripped.slice(0, MAX_FETCH_BYTES) + "\n...[truncated]" : stripped,
                },
            };
        } catch (err: any) {
            return { success: false, data: null, error: err.name === "AbortError" ? `Fetch timed out after ${FETCH_TIMEOUT_MS}ms` : err.message };
        } finally {
            clearTimeout(timer);
        }
    },
};

function stripMarkup(text: string, contentType: string): string {
    if (/json|xml/.test(contentType)) return text.trim();
    return text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

const httpRequest: ToolSpec = {
    name: "http_request",
    description: "Make a general HTTP request to any API or URL (GET, POST, PUT, PATCH, DELETE, HEAD), with custom headers and body. More flexible than fetch_url or web_search for calling specific APIs (e.g. a local home automation server, a webhook, a REST API). Requires user approval since it can have side effects.",
    category: "web",
    requiresApproval: true,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            url: { type: "string", description: "Absolute http(s) URL" },
            method: { type: "string", description: "HTTP method (default GET)", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], default: "GET" },
            headers: { type: "object", description: "Request headers as a flat object of string key/value pairs" },
            body: { type: "string", description: "Raw request body, e.g. a JSON string. Only used for POST/PUT/PATCH." },
        },
        required: ["url"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const url = typeof params.url === "string" ? params.url : "";
        if (!/^https?:\/\//i.test(url)) return { success: false, data: null, error: "Only http(s) URLs are supported" };

        const method = typeof params.method === "string" ? params.method.toUpperCase() : "GET";
        if (!HTTP_METHODS.has(method)) return { success: false, data: null, error: `Unsupported method: ${method}` };

        const headers: Record<string, string> = { "User-Agent": "Jarvis/1.0 (local assistant)" };
        if (params.headers && typeof params.headers === "object") {
            for (const [key, value] of Object.entries(params.headers as Record<string, unknown>)) {
                headers[key] = String(value);
            }
        }

        const body = typeof params.body === "string" && ["POST", "PUT", "PATCH"].includes(method) ? params.body : undefined;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(url, { method, headers, body, signal: controller.signal, redirect: "follow" });
            const text = await response.text();
            const truncated = text.length > MAX_FETCH_BYTES;
            return {
                success: response.ok,
                data: {
                    status: response.status,
                    statusText: response.statusText,
                    contentType: response.headers.get("content-type") || "",
                    truncated,
                    body: truncated ? text.slice(0, MAX_FETCH_BYTES) + "\n...[truncated]" : text,
                },
                error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
            };
        } catch (err: any) {
            return { success: false, data: null, error: err.name === "AbortError" ? "Request timed out" : err.message };
        } finally {
            clearTimeout(timer);
        }
    },
};

const getWeather: ToolSpec = {
    name: "get_weather",
    description: "Current weather conditions for a city or location: temperature, feels-like, humidity, wind, and text description. Uses the free wttr.in service.",
    category: "web",
    requiresApproval: false,
    timeoutMs: 20000,
    parameters: {
        type: "object",
        properties: {
            location: { type: "string", description: "City or place name, e.g. 'Berlin' or 'San Francisco, CA'. Auto-detects from IP if omitted." },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const location = typeof params.location === "string" && params.location.trim()
            ? encodeURIComponent(params.location.trim().replace(/\s+/g, " "))
            : "";
        const url = `https://wttr.in/${location}?format=j1`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { "Accept": "application/json", "User-Agent": "curl/8" },
            });
            if (!response.ok) return { success: false, data: null, error: `HTTP ${response.status} ${response.statusText}` };
            const json = await response.json() as {
                current_condition: Array<{
                    temp_C: string;
                    temp_F: string;
                    FeelsLikeC: string;
                    humidity: string;
                    windspeedKmph: string;
                    weatherDesc: Array<{ value: string }>;
                    observation_time: string;
                }>;
                nearest_area: Array<{ areaName: Array<{ value: string }>; region: Array<{ value: string }>; country: Array<{ value: string }> }>;
            };
            const current = json.current_condition?.[0];
            const area = json.nearest_area?.[0];
            if (!current) return { success: false, data: null, error: "No weather data returned" };
            return {
                success: true,
                data: {
                    location: area ? {
                        name: area.areaName?.[0]?.value,
                        region: area.region?.[0]?.value,
                        country: area.country?.[0]?.value,
                    } : (location ? decodeURIComponent(location) : "auto"),
                    tempC: Number(current.temp_C),
                    tempF: Number(current.temp_F),
                    feelsLikeC: Number(current.FeelsLikeC),
                    humidityPercent: Number(current.humidity),
                    windKmph: Number(current.windspeedKmph),
                    description: current.weatherDesc?.[0]?.value || "",
                    observedAt: current.observation_time,
                },
            };
        } catch (err: any) {
            return { success: false, data: null, error: err.name === "AbortError" ? "Weather request timed out" : err.message };
        } finally {
            clearTimeout(timer);
        }
    },
};

const webTools: ToolSpec[] = [webSearch, fetchUrl, httpRequest, getWeather];
export default webTools;