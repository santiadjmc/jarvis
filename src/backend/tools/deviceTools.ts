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
    description: "Read the current text on a client device's clipboard. Requires user approval since the clipboard may contain passwords or other secrets.",
    category: "utility",
    requiresApproval: true,
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
    description: "Show a local notification on a client device, visible even while the app is backgrounded. Use this to get the user's attention for something important or time-sensitive. Requires user approval.",
    category: "utility",
    requiresApproval: true,
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

const deviceListContacts: ToolSpec = {
    name: "device_list_contacts",
    description: "Search the client device's contacts (people) by name and return their phone numbers. Use this to resolve a person's name to a number before calling/texting/messaging them. Requires user approval since it's personal data about other people.",
    category: "utility",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:list_contacts",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            query: { type: "string", description: "Name (or partial name) to search for. Omit to list all contacts." },
        },
    },
    async execute() {
        return unsupported("device_list_contacts");
    },
};

const deviceLaunchApp: ToolSpec = {
    name: "device_launch_app",
    description: "Open/launch another app on the client device by name or package name (see device_list_installed_apps).",
    category: "system",
    requiresApproval: false,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:launch_app",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            app: { type: "string", description: "App name (e.g. 'Spotify') or exact package name (e.g. 'com.spotify.music')" },
        },
        required: ["app"],
    },
    async execute() {
        return unsupported("device_launch_app");
    },
};

const deviceListInstalledApps: ToolSpec = {
    name: "device_list_installed_apps",
    description: "List apps installed on the client device, with their display names and package names.",
    category: "system",
    requiresApproval: false,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:list_installed_apps",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            query: { type: "string", description: "Only return apps whose name contains this (case-insensitive). Omit to list all." },
        },
    },
    async execute() {
        return unsupported("device_list_installed_apps");
    },
};

const devicePlayMusic: ToolSpec = {
    name: "device_play_music",
    description: "Open a music app on the client device and search for/play something (e.g. a song, artist, or playlist). Tries Spotify first, falls back to YouTube Music.",
    category: "utility",
    requiresApproval: false,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:play_music",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            query: { type: "string", description: "What to search for/play, e.g. 'Bohemian Rhapsody Queen'" },
            app: { type: "string", description: "Which app to use: 'spotify' or 'youtube_music' (default: tries spotify, falls back automatically)", enum: ["spotify", "youtube_music"] },
        },
        required: ["query"],
    },
    async execute() {
        return unsupported("device_play_music");
    },
};

const deviceCallNumber: ToolSpec = {
    name: "device_call_number",
    description: "Place a real phone call to a number from the client device, immediately, no confirmation dialog shown to the user beforehand. Requires user approval.",
    category: "communication",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:call_number",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            number: { type: "string", description: "Phone number to call" },
        },
        required: ["number"],
    },
    async execute() {
        return unsupported("device_call_number");
    },
};

const deviceSendSms: ToolSpec = {
    name: "device_send_sms",
    description: "Send a real SMS text message from the client device's own number, immediately, fully automatically. Requires user approval.",
    category: "communication",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:send_sms",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            number: { type: "string", description: "Recipient phone number" },
            message: { type: "string", description: "Message text" },
        },
        required: ["number", "message"],
    },
    async execute() {
        return unsupported("device_send_sms");
    },
};

const deviceAccessibilityStatus: ToolSpec = {
    name: "device_accessibility_status",
    description: "Check whether Jarvis's screen-reading/automation (accessibility) service is enabled on the client device. If not, tell the user it needs to be turned on manually in Settings > Accessibility > Jarvis (Android requires this be done by hand; it cannot be auto-granted).",
    category: "system",
    requiresApproval: false,
    timeoutMs: 15000,
    runtime: "device",
    capability: "device:accessibility_status",
    parameters: {
        type: "object",
        properties: { device: deviceParam },
    },
    async execute() {
        return unsupported("device_accessibility_status");
    },
};

const deviceReadScreen: ToolSpec = {
    name: "device_read_screen",
    description: "Read everything currently visible on the client device's screen (text, buttons, labels across all apps, not just Jarvis) via the accessibility service. Use this to see what app/screen the user is on before tapping or typing something.",
    category: "system",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:read_screen",
    parameters: {
        type: "object",
        properties: { device: deviceParam },
    },
    async execute() {
        return unsupported("device_read_screen");
    },
};

const deviceTap: ToolSpec = {
    name: "device_tap",
    description: "Tap a button/element on the client device's screen, identified by its visible text/label (from device_read_screen) or exact screen coordinates. This controls whatever app is currently on screen, not just Jarvis. Requires user approval.",
    category: "system",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:tap",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            text: { type: "string", description: "Visible text/label of the element to tap (partial match)" },
            x: { type: "number", description: "Screen x coordinate (alternative to text)" },
            y: { type: "number", description: "Screen y coordinate (alternative to text)" },
        },
    },
    async execute() {
        return unsupported("device_tap");
    },
};

const deviceTypeText: ToolSpec = {
    name: "device_type_text",
    description: "Type text into a focused/identified input field on the client device's current screen (any app). Requires user approval.",
    category: "system",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:type_text",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            text: { type: "string", description: "Visible text/label/hint near the input field to identify it (partial match)" },
            value: { type: "string", description: "Text to type into the field" },
        },
        required: ["value"],
    },
    async execute() {
        return unsupported("device_type_text");
    },
};

const deviceSwipe: ToolSpec = {
    name: "device_swipe",
    description: "Swipe/scroll on the client device's current screen from one point to another. Requires user approval.",
    category: "system",
    requiresApproval: true,
    timeoutMs: 20000,
    runtime: "device",
    capability: "device:swipe",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            x1: { type: "number", description: "Start x" },
            y1: { type: "number", description: "Start y" },
            x2: { type: "number", description: "End x" },
            y2: { type: "number", description: "End y" },
        },
        required: ["x1", "y1", "x2", "y2"],
    },
    async execute() {
        return unsupported("device_swipe");
    },
};

const deviceNavigate: ToolSpec = {
    name: "device_navigate",
    description: "Press a system navigation button on the client device: 'back', 'home', or 'recents'.",
    category: "system",
    requiresApproval: false,
    timeoutMs: 15000,
    runtime: "device",
    capability: "device:navigate",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            action: { type: "string", enum: ["back", "home", "recents"], description: "Which navigation action to perform" },
        },
        required: ["action"],
    },
    async execute() {
        return unsupported("device_navigate");
    },
};

const deviceSendWhatsappMessage: ToolSpec = {
    name: "device_send_whatsapp_message",
    description: "Send a WhatsApp message to a phone number from the client device, fully automatically (no tap needed from the user) via the accessibility service. Requires the accessibility service to be enabled (see device_accessibility_status) and WhatsApp installed. Requires user approval.",
    category: "communication",
    requiresApproval: true,
    timeoutMs: 30000,
    runtime: "device",
    capability: "device:send_whatsapp_message",
    parameters: {
        type: "object",
        properties: {
            device: deviceParam,
            number: { type: "string", description: "Recipient phone number in international format, e.g. +15551234567" },
            message: { type: "string", description: "Message text to send" },
        },
        required: ["number", "message"],
    },
    async execute() {
        return unsupported("device_send_whatsapp_message");
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
    "device:list_contacts",
    "device:launch_app",
    "device:list_installed_apps",
    "device:play_music",
    "device:call_number",
    "device:send_sms",
    "device:accessibility_status",
    "device:read_screen",
    "device:tap",
    "device:type_text",
    "device:swipe",
    "device:navigate",
    "device:send_whatsapp_message",
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
    deviceListContacts,
    deviceLaunchApp,
    deviceListInstalledApps,
    devicePlayMusic,
    deviceCallNumber,
    deviceSendSms,
    deviceAccessibilityStatus,
    deviceReadScreen,
    deviceTap,
    deviceTypeText,
    deviceSwipe,
    deviceNavigate,
    deviceSendWhatsappMessage,
    deviceRunCommand,
];

export default deviceTools;