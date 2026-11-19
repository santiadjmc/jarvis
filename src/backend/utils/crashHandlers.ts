import Log from "../Log";

/** How long to wait for the async log transports before exiting. */
const EXIT_DELAY_MS = 250;

let exiting = false;

/**
 * After an uncaught exception the process is in an undefined state (half-applied
 * conversation state, held locks, stuck flags), so it's logged and the process
 * exits non-zero; ProcessManager (`npm run start:managed`) restarts it.
 * Unhandled rejections are only logged.
 */
export function handleUncaughtException(err: unknown, exit: (code: number) => void = code => process.exit(code)): void {
    const error = err instanceof Error ? err : new Error(String(err));
    // stderr is synchronous, so the reason survives even if the log file write doesn't.
    process.stderr.write(`Uncaught exception, exiting: ${error.stack ?? error.message}\n`);
    if (exiting) return;
    exiting = true;
    Log.error("Uncaught exception, exiting so the process manager can restart Jarvis", error);
    process.exitCode = 1;
    setTimeout(() => exit(1), EXIT_DELAY_MS);
}

export function handleUnhandledRejection(reason: unknown): void {
    Log.error("Unhandled promise rejection", reason instanceof Error ? reason : new Error(String(reason)));
}

export function installCrashHandlers(): void {
    process.on("uncaughtException", err => handleUncaughtException(err));
    process.on("unhandledRejection", handleUnhandledRejection);
}

/** Test hook. */
export function resetCrashStateForTests(): void {
    exiting = false;
}
