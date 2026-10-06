import { randomInt, randomUUID } from "crypto";
import type { ToolContext, ToolResult, ToolSpec } from "../types";

const CHARSETS = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    symbols: "!@#$%^&*()-_=+[]{}",
};

const generatePassword: ToolSpec = {
    name: "generate_password",
    description: "Generate a cryptographically random password.",
    category: "utility",
    requiresApproval: false,
    timeoutMs: 5000,
    parameters: {
        type: "object",
        properties: {
            length: { type: "number", description: "Password length (default 20, max 128)", default: 20 },
            symbols: { type: "boolean", description: "Include symbols (default true)", default: true },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const length = Math.max(4, Math.min(128, Math.round(Number(params.length ?? 20))));
        const useSymbols = params.symbols !== false;
        const alphabet = CHARSETS.lower + CHARSETS.upper + CHARSETS.digits + (useSymbols ? CHARSETS.symbols : "");
        let password = "";
        for (let i = 0; i < length; i++) {
            password += alphabet[randomInt(alphabet.length)];
        }
        return { success: true, data: { password, length } };
    },
};

const generateUuid: ToolSpec = {
    name: "generate_uuid",
    description: "Generate one or more random UUID v4 identifiers.",
    category: "utility",
    requiresApproval: false,
    timeoutMs: 5000,
    parameters: {
        type: "object",
        properties: {
            count: { type: "number", description: "How many UUIDs to generate (default 1, max 50)", default: 1 },
        },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const count = Math.max(1, Math.min(50, Math.round(Number(params.count ?? 1))));
        const uuids = Array.from({ length: count }, () => randomUUID());
        return { success: true, data: { uuids } };
    },
};

type UnitKind = "length" | "mass" | "temperature" | "volume";

const LENGTH_TO_METERS: Record<string, number> = {
    m: 1, meter: 1, meters: 1, km: 1000, kilometer: 1000, kilometers: 1000,
    cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344,
    yd: 0.9144, yard: 0.9144, yards: 0.9144, ft: 0.3048, foot: 0.3048, feet: 0.3048,
    in: 0.0254, inch: 0.0254, inches: 0.0254,
};

const MASS_TO_GRAMS: Record<string, number> = {
    g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000,
    mg: 0.001, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
    oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
};

const VOLUME_TO_LITERS: Record<string, number> = {
    l: 1, liter: 1, liters: 1, ml: 0.001, milliliter: 0.001, milliliters: 0.001,
    gal: 3.78541, gallon: 3.78541, gallons: 3.78541, qt: 0.946353, quart: 0.946353,
    cup: 0.236588, cups: 0.236588, floz: 0.0295735,
};

function kindOf(unit: string): UnitKind | null {
    const u = unit.toLowerCase();
    if (u in LENGTH_TO_METERS) return "length";
    if (u in MASS_TO_GRAMS) return "mass";
    if (u in VOLUME_TO_LITERS) return "volume";
    if (["c", "celsius", "f", "fahrenheit", "k", "kelvin"].includes(u)) return "temperature";
    return null;
}

function convertTemperature(value: number, from: string, to: string): number {
    const f = from.toLowerCase();
    const t = to.toLowerCase();
    let celsius: number;
    if (f.startsWith("c")) celsius = value;
    else if (f.startsWith("f")) celsius = (value - 32) * (5 / 9);
    else celsius = value - 273.15;

    if (t.startsWith("c")) return celsius;
    if (t.startsWith("f")) return celsius * (9 / 5) + 32;
    return celsius + 273.15;
}

const convertUnits: ToolSpec = {
    name: "convert_units",
    description: "Convert a numeric value between units of length, mass, volume, or temperature (e.g. miles to km, lbs to kg, Fahrenheit to Celsius).",
    category: "utility",
    requiresApproval: false,
    timeoutMs: 5000,
    parameters: {
        type: "object",
        properties: {
            value: { type: "number", description: "Numeric value to convert" },
            from: { type: "string", description: "Source unit, e.g. 'miles', 'kg', 'fahrenheit'" },
            to: { type: "string", description: "Target unit, e.g. 'km', 'lbs', 'celsius'" },
        },
        required: ["value", "from", "to"],
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
        const value = Number(params.value);
        const from = typeof params.from === "string" ? params.from.trim() : "";
        const to = typeof params.to === "string" ? params.to.trim() : "";
        if (!Number.isFinite(value)) return { success: false, data: null, error: "value must be a number" };
        if (!from || !to) return { success: false, data: null, error: "from and to are required" };

        const fromKind = kindOf(from);
        const toKind = kindOf(to);
        if (!fromKind || !toKind) return { success: false, data: null, error: `Unknown unit: ${!fromKind ? from : to}` };
        if (fromKind !== toKind) return { success: false, data: null, error: `Cannot convert ${fromKind} to ${toKind}` };

        let result: number;
        if (fromKind === "temperature") {
            result = convertTemperature(value, from, to);
        } else {
            const table = fromKind === "length" ? LENGTH_TO_METERS : fromKind === "mass" ? MASS_TO_GRAMS : VOLUME_TO_LITERS;
            const base = value * table[from.toLowerCase()];
            result = base / table[to.toLowerCase()];
        }

        return { success: true, data: { value, from, to, result: Math.round(result * 1e6) / 1e6 } };
    },
};

const utilityTools: ToolSpec[] = [generatePassword, generateUuid, convertUnits];
export default utilityTools;
