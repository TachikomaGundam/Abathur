import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

/**
 * Start a long run and return in well under a second. Progress is written to
 * statePath; callers poll that file instead of blocking.
 * @param {{name:string, command:string[], statePath:string, logPath:string}} options
 */
export function startLongRun(options) {
  const state = { name: options.name, status: "running", startedAt: new Date().toISOString(), pid: null };
  writeFileSync(options.statePath, `${JSON.stringify(state, null, 2)}\n`);
  const child = spawn(options.command[0], options.command.slice(1), {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeFileSync(options.statePath, `${JSON.stringify({ ...state, pid: child.pid }, null, 2)}\n`);
  child.stdout.on("data", (chunk) => appendFileSync(options.logPath, chunk));
  child.stderr.on("data", (chunk) => appendFileSync(options.logPath, chunk));
  child.on("exit", (code, signal) => {
    const final = { name: options.name, status: "exited", code, signal, pid: child.pid, endedAt: new Date().toISOString() };
    writeFileSync(options.statePath, `${JSON.stringify(final, null, 2)}\n`);
  });
  child.unref();
  return { pid: child.pid, statePath: options.statePath, logPath: options.logPath };
}

export function probeRun(statePath, readFile) {
  try {
    return JSON.parse(readFile(statePath, "utf8"));
  } catch {
    return { status: "unknown" };
  }
}
