import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "fs";
import { dirname } from "path";
import Log from "../Log";

/**
 * Loads a `{ [key]: T[] }` JSON store. A missing file yields an empty store.
 * A file that can't be parsed (or has the wrong shape) is moved aside to
 * `<path>.corrupt-<timestamp>` and logged, so the next save can't silently
 * overwrite the only copy of the user's data.
 */
export function loadJsonStore<T>(path: string, key: string, label: string): Record<string, T[]> {
    if (!existsSync(path)) return { [key]: [] };
    let raw: string;
    try {
        raw = readFileSync(path, "utf-8");
    } catch (err: any) {
        // Unreadable (permissions, I/O): don't pretend it's empty and overwrite it.
        throw new Error(`Failed to read ${label} store at ${path}: ${err.message}`);
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed[key])) return parsed;
        throw new Error(`missing "${key}" array`);
    } catch (err: any) {
        const backup = `${path}.corrupt-${Date.now()}`;
        try {
            renameSync(path, backup);
        } catch (renameErr: any) {
            throw new Error(`${label} store at ${path} is corrupt (${err.message}) and could not be backed up: ${renameErr.message}`);
        }
        Log.error(`${label} store was corrupt; moved it aside and starting empty`, new Error(`${err.message} (backup: ${backup})`));
        return { [key]: [] };
    }
}

/** Writes JSON atomically: temp file + fsync + rename, so a crash can't truncate the store. */
export function saveJsonAtomic(path: string, data: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    try {
        writeSync(fd, JSON.stringify(data, null, 2));
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
    renameSync(tmp, path);
}
