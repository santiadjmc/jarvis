import type { ToolResult, ToolSpec } from "./types";

const deviceParam = {
    type: "string",
    description: "Target device id or name from list_devices. Omit to run on the device that sent the request.",
};

const unsupported = (name: string): ToolResult => {
    return { success: false, data: null, error: `${name} cannot be executed on the server; it runs on a client device.` };
};

const deviceTime: ToolSpec = {
    name: "device_get_time",
    description: "Get the current local date, time, and timezone on a client device.",
    category: "system",
    requiresApproval: false,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:time",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
        },
    },
    async execute() {
        return unsupported("device_get_time");
    },
};

const deviceInfo: ToolSpec = {
    name: "device_get_info",
    description: "Get information about a client device: model, manufacturer, OS, architecture, locale, screen resolution, and app version.",
    category: "system",
    requiresApproval: false,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:info",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
        },
    },
    async execute() {
        return unsupported("device_get_info");
    },
};

const deviceGetClipboard: ToolSpec = {
    name: "device_get_clipboard",
    description: "Read the current text on a client device's clipboard.",
    category: "utility",
    requiresApproval: false,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:get_clipboard",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
        },
    },
    async execute() {
        return unsupported("device_get_clipboard");
    },
};

const deviceSetClipboard: ToolSpec = {
    name: "device_set_clipboard",
    description: "Copy text to a client device's clipboard.",
    category: "utility",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:set_clipboard",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            text: { type: "string", description: "Text to copy to the clipboard" },
        },
        required: ["text"],
    },
    async execute() {
        return unsupported("device_set_clipboard");
    },
};

const deviceOpenUrl: ToolSpec = {
    name: "device_open_url",
    description: "Open a URL in the browser on a client device.",
    category: "web",
    requiresApproval: true,
    timeoutMs: 30000,
    runtime: "device",
    capability: "device:open_url",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            url: { type: "string", description: "Absolute URL to open (https:// or http://)" },
        },
        required: ["url"],
    },
    async execute() {
        return unsupported("device_open_url");
    },
};

const deviceVibrate: ToolSpec = {
    name: "device_vibrate",
    description: "Trigger a short haptic vibration on a client device.",
    category: "utility",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:vibrate",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
        },
    },
    async execute() {
        return unsupported("device_vibrate");
    },
};

const deviceShowNotification: ToolSpec = {
    name: "device_show_notification",
    description: "Show a local notification on a client device, visible even while the app is backgrounded. Use this to get the user's attention for something important or time-sensitive.",
    category: "utility",
    requiresApproval: false,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:show_notification",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            title: { type: "string", description: "Notification title" },
            body: { type: "string", description: "Notification body text" },
        },
        required: ["title", "body"],
    },
    async execute() {
        return unsupported("device_show_notification");
    },
};

const deviceGetBattery: ToolSpec = {
    name: "device_get_battery",
    description: "Get a client device's battery level and charging state.",
    category: "system",
    requiresApproval: false,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:get_battery",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
        },
    },
    async execute() {
        return unsupported("device_get_battery");
    },
};

const deviceGetLocation: ToolSpec = {
    name: "device_get_location",
    description: "Get a client device's current GPS location (latitude, longitude, accuracy). Requires user approval since it is privacy-sensitive.",
    category: "system",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:get_location",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
        },
    },
    async execute() {
        return unsupported("device_get_location");
    },
};

const deviceRunCommand: ToolSpec = {
    name: "device_run_command",
    description: "Run a shell command on a client device (Android and desktop only; the phone app's own sandbox, not root).",
    category: "code",
    requiresApproval: true,
    timeoutMs: 60000,
    runtime: "device",
    capability: "device:run_command",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            command: { type: "string", description: "Shell command to run on the device" },
        },
        required: ["command"],
    },
    async execute() {
        return unsupported("device_run_command");
    },
};

export const deviceToolCapabilities = [
    "device:time",
    "device:info",
    "device:get_clipboard",
    "device:set_clipboard",
    "device:open_url",
    "device:vibrate",
    "device:run_command",
    "device:show_notification",
    "device:get_battery",
    "device:get_location",
];

const deviceTools: ToolSpec[] = [
    deviceTime,
    deviceInfo,
    deviceGetClipboard,
    deviceSetClipboard,
    deviceOpenUrl,
    deviceVibrate,
    deviceShowNotification,
    deviceGetBattery,
    deviceGetLocation,
    deviceRunCommand,
];

export default deviceTools;