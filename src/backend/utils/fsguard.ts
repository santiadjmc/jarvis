import { realpath } from "fs/promises";
import { homedir, tmpdir } from "os";
import { basename, join, resolve, sep } from "path";

/**
 * Guards the approval-free file tools (read_file, list_dir, search_files,
 * grep_files). Anything the model reads can be steered by prompt injection, so
 * reads are confined to allowed roots and never touch credential stores.
 *
 * Roots: JARVIS_FS_ROOTS (comma-separated absolute paths), default
 * $HOME, the working directory and the OS temp dir. Use "/" to allow the
 * whole filesystem; the deny-list below still applies.
 */

const DENIED_DIR_NAMES = new Set([".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".password-store", ".gcloud"]);
const DENIED_FILE_NAMES = new Set([
    ".netrc", ".npmrc", ".pypirc", ".git-credentials", ".pgpass", ".my.cnf",
    "credentials", "credentials.json", "google_tokens.json",
]);
const ALLOWED_ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template"]);
const DENIED_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"];
const DENIED_PREFIXES = ["/proc", "/sys", "/dev", "/etc/shadow", "/etc/gshadow", "/etc/sudoers", "/etc/ssh", "/root/.ssh", "/var/run/secrets"];

function dataDir(): string {
    return process.env.JARVIS_DATA_DIR || join(homedir(), ".local", "share", "jarvis");
}

function within(path: string, root: string): boolean {
    if (root === sep) return true;
    return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

export function allowedRoots(): string[] {
    const raw = (process.env.JARVIS_FS_ROOTS || "").split(",").map(s => s.trim()).filter(Boolean);
    const roots = raw.length > 0 ? raw : [homedir(), process.cwd(), tmpdir()];
    return roots.map(r => resolve(r));
}

/** Returns a reason string when the (already resolved, real) path is denied. */
export function deniedReason(path: string): string | null {
    for (const prefix of [...DENIED_PREFIXES, resolve(dataDir())]) {
        if (within(path, prefix)) return `access to ${prefix} is not allowed`;
    }
    const parts = path.split(sep);
    for (const part of parts) {
        if (DENIED_DIR_NAMES.has(part)) return `access to ${part} directories is not allowed`;
    }
    const name = basename(path).toLowerCase();
    if (DENIED_FILE_NAMES.has(name)) return `${name} may contain credentials`;
    if ((name === ".env" || name.startsWith(".env.")) && !ALLOWED_ENV_TEMPLATES.has(name)) return `${name} may contain secrets`;
    if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(name)) return `${name} looks like a private key`;
    if (DENIED_EXTENSIONS.some(ext => name.endsWith(ext))) return `${name} looks like a key or certificate store`;
    if (!allowedRoots().some(root => within(path, root))) {
        return `path is outside the allowed roots (${allowedRoots().join(", ")}); set JARVIS_FS_ROOTS to change`;
    }
    return null;
}

/**
 * Resolves symlinks (falling back to the lexical path when the target does not
 * exist) and checks the result. Returns the real path, or throws with a reason.
 */
export async function assertReadablePath(path: string): Promise<string> {
    const lexical = resolve(path);
    let real = lexical;
    try {
        real = await realpath(lexical);
    } catch {
        // Nonexistent paths are checked lexically; the caller's fs call will fail anyway.
    }
    const reason = deniedReason(lexical) ?? deniedReason(real);
    if (reason) throw new Error(`Refusing to read ${lexical}: ${reason}`);
    return real;
}

/** Boolean variant for directory walkers (skip silently). */
export async function isReadablePath(path: string): Promise<boolean> {
    try {
        await assertReadablePath(path);
        return true;
    } catch {
        return false;
    }
}
