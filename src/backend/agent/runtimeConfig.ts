let autoApproveOverride: boolean | null = null;

function envDefault(): boolean {
    return ["1", "true", "yes"].includes((process.env.JARVIS_AUTO_APPROVE || "").toLowerCase());
}

export function isAutoApproveEnabled(): boolean {
    return autoApproveOverride ?? envDefault();
}

export function setAutoApprove(value: boolean): void {
    autoApproveOverride = value;
}
