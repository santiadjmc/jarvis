export function estimateTokens(text: string): number {
    if (!text) return 0;
    let tokens = 0;
    let i = 0;
    const n = text.length;
    while (i < n) {
        const code = text.charCodeAt(i);
        if (code < 0x80) {
            tokens += 1;
            i += 1;
        } else if (code < 0x800) {
            tokens += 2;
            i += 1;
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < n && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
            tokens += 2;
            i += 2;
        } else {
            tokens += 3;
            i += 1;
        }
    }
    return Math.max(1, Math.ceil(tokens / 4));
}

export function estimateMessageTokens(role: string, content: string): number {
    return estimateTokens(role) + estimateTokens(content) + 4;
}