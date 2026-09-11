// abathur-opencode-plugin v0.2.0
// Official opencode plugin adapter for the abathur evolution harness.
// Registers ONE agent tool, `abathur`, that shells out to the abathur CLI —
// argv-only (node:child_process execFile, never a shell), top-level commands
// restricted to an allowlist, hard timeout, capped output. The CLI itself
// remains the human gate; this adapter only lets a session *ask* abathur.
//
// V1 plugin format (opencode >= 1.14): default export { id, server }, where
// server(input, options) resolves to Hooks; Hooks.tool is a
// { [name]: ToolDefinition } record (see @opencode-ai/plugin).
// This file is shipped as-is (package.json "files") and copied into
// ~/.config/opencode/plugins/ by `abathur opencode install`. It is NOT
// compiled by abathur's tsc; "@opencode-ai/plugin" resolves inside opencode's
// own config-directory install.

import { execFile } from "node:child_process";
import { tool } from "@opencode-ai/plugin";

/** Spawn cap: a CLI call that outlives this is killed and reported, never awaited forever. */
const TIMEOUT_MS = 120_000;
/** Per-stream output cap fed back into the session; keeps one tool call from flooding context. */
const MAX_OUTPUT_BYTES = 64 * 1024;

/** The nine real top-level commands plus --help. Anything else is refused locally. */
const ALLOWED_COMMANDS: readonly string[] = [
  "genome",
  "run",
  "status",
  "promote",
  "tombstone",
  "bundle",
  "graft",
  "self-eval",
  "kernel",
  "--help",
];

function resolveBin(): string {
  const configured = process.env["ABATHUR_BIN"];
  return configured === undefined || configured.length === 0 ? "abathur" : configured;
}

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly note: string;
}

/** The subset of the execFile error shape this adapter reads (node sets `code` to the numeric exit status on non-zero exits). */
interface SpawnError extends Error {
  readonly code?: string | number | null;
  readonly killed?: boolean;
  readonly signal?: string | null;
}

/** Never rejects: every spawn failure becomes a structured result the agent can read. */
function runCli(bin: string, argv: readonly string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      [...argv],
      { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, shell: false },
      (error, stdout, stderr) => {
        const out = stdout.slice(0, MAX_OUTPUT_BYTES);
        const errOut = stderr.slice(0, MAX_OUTPUT_BYTES);
        if (error === null) {
          resolve({ status: 0, stdout: out, stderr: errOut, note: "" });
          return;
        }
        const failure = error as SpawnError;
        if (failure.code === "ENOENT") {
          resolve({
            status: 127,
            stdout: out,
            stderr: errOut,
            note: `binary '${bin}' not found — install abathur globally or point ABATHUR_BIN at it`,
          });
          return;
        }
        if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          resolve({
            status: -1,
            stdout: out,
            stderr: errOut,
            note: `output truncated at ${String(MAX_OUTPUT_BYTES)} bytes (cap per stream)`,
          });
          return;
        }
        if (typeof failure.code !== "number") {
          const timedOut = failure.killed === true || (failure.signal !== undefined && failure.signal !== null);
          resolve({
            status: timedOut ? 124 : -1,
            stdout: out,
            stderr: errOut,
            note: timedOut
              ? `killed after ${String(TIMEOUT_MS / 1000)}s timeout (signal: ${String(failure.signal ?? "SIGTERM")})`
              : `spawn failed: ${failure.message}`,
          });
          return;
        }
        // Ordinary non-zero exit: the CLI's own verdict (blocked / cannot-answer).
        resolve({ status: failure.code, stdout: out, stderr: errOut, note: "" });
      },
    );
  });
}

export default {
  id: "abathur",
  server: async () => ({
    tool: {
      abathur: tool({
        description:
          "Run the abathur evolution-harness CLI on this machine. " +
          "Pass the top-level command word in `command` (one of: genome, run, status, " +
          "promote, tombstone, bundle, graft, self-eval, kernel, --help) and every " +
          "remaining argv token in `extra`. The call is spawned argv-only (no shell) " +
          "with a 120s timeout; the result text always ends with the CLI exit code " +
          "(0 ok, 1 blocked decision, 2 cannot-answer). Promotion is a human gate — " +
          "never call `promote` without the user explicitly asking.",
        args: {
          command: tool.schema
            .string()
            .describe("top-level abathur command, e.g. 'genome' or 'status' or '--help'"),
          extra: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("remaining argv tokens, e.g. ['add', '/path/to/genome.jsonc']"),
        },
        execute: async (args, context) => {
          const command = args.command.trim();
          if (!ALLOWED_COMMANDS.includes(command)) {
            return (
              `abathur: refused '${command}' — not an allowed top-level command. ` +
              `Allowed: ${ALLOWED_COMMANDS.join(", ")}. Put the command word in 'command' ` +
              `and every other token in 'extra'.`
            );
          }
          const argv: readonly string[] = [command, ...(args.extra ?? [])];
          context.metadata({ title: `abathur ${argv.join(" ")}` });
          const bin = resolveBin();
          const result = await runCli(bin, argv);
          const sections = [
            `$ abathur ${argv.join(" ")}`,
            `exit: ${String(result.status)}`,
          ];
          if (result.note.length > 0) sections.push(`note: ${result.note}`);
          sections.push(`--- stdout ---\n${result.stdout.length === 0 ? "(empty)" : result.stdout}`);
          sections.push(`--- stderr ---\n${result.stderr.length === 0 ? "(empty)" : result.stderr}`);
          return sections.join("\n");
        },
      }),
    },
  }),
};
