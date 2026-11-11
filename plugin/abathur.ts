// abathur-opencode-plugin v0.3.0 — OpenCode V2 native
// Official opencode plugin adapter for the abathur evolution harness.
// Registers ONE agent tool, `abathur`, that shells out to the abathur CLI —
// argv-only (node:child_process execFile, never a shell), top-level commands
// restricted to an allowlist, hard timeout, capped output. The CLI itself
// remains the human gate; this adapter only lets a session *ask* abathur.
//
// V2 plugin format (opencode >= 2.x): default export { id, setup(ctx) }.
// Tool registered via ctx.tool.transform(editor.add) with a JSON Schema input.
// No imports from any opencode package: the file is loaded by the server, which
// hosts no installable @opencode packages in the config directory's node_modules.
// The /abathur slash command is delivered by the file
// ~/.config/opencode/commands/abathur.md (Route A); V1's config-hook
// self-registration (Route B) is gone — V2 has no matching hook surface.
//
// V1 original archived at:
// /home/lab/workspace/debug/opencode-v1-plugins-archive-20261111/abathur.ts.v1-original
//
// Install route: this file is the authoritative source in the repo
// (plugin/abathur.ts). The session-visible copy lives at
// ~/.config/opencode/plugins/abathur.ts (byte copy; owner-approved route).

import { execFile } from "node:child_process";

/** Spawn cap: a CLI call that outlives this is killed and reported, never awaited forever. */
const TIMEOUT_MS = 120_000;
/** Per-stream output cap fed back into the session; keeps one tool call from flooding context. */
const MAX_OUTPUT_BYTES = 64 * 1024;

/** The seven tool-reachable top-level commands plus --help. Anything else is refused locally.
 * promote/tombstone are human gates and deliberately terminal-only (0.2.1): not reachable here. */
const ALLOWED_COMMANDS: readonly string[] = [
  "genome",
  "run",
  "status",
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
          if (timedOut) {
            let note = `killed after ${String(TIMEOUT_MS / 1000)}s timeout (signal: ${String(failure.signal ?? "SIGTERM")})`;
            if (argv[0] === "run") {
              // The timeout kills the CLI only; mutator/bench children are detached by design.
              note +=
                " — abathur run spawns detached children (mutator/bench sessions) " +
                "that may still be running — the next 'abathur run' reaps them";
            }
            resolve({ status: 124, stdout: out, stderr: errOut, note });
            return;
          }
          resolve({ status: -1, stdout: out, stderr: errOut, note: `spawn failed: ${failure.message}` });
          return;
        }
        // Ordinary non-zero exit: the CLI's own verdict (blocked / cannot-answer).
        resolve({ status: failure.code, stdout: out, stderr: errOut, note: "" });
      },
    );
  });
}

interface ToolInput {
  readonly command: string;
  readonly extra?: readonly string[];
}

export default {
  id: "abathur",
  async setup(ctx: {
    tool: {
      transform(cb: (editor: {
        add(def: unknown): unknown;
      }) => void): Promise<unknown>;
    };
  }) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "abathur",
        description:
          "Run the abathur evolution-harness CLI on this machine. " +
          "Pass the top-level command word in `command` (one of: genome, run, status, " +
          "bundle, graft, self-eval, kernel, --help) and every " +
          "remaining argv token in `extra`. The call is spawned argv-only (no shell) " +
          "with a 120s timeout; the result text always ends with the CLI exit code " +
          "(0 ok, 1 blocked decision, 2 cannot-answer). Honest privilege note: this " +
          "tool carries bash-equivalent privilege — `run` and `genome` legitimately " +
          "spawn mutator/engine binaries by design — so the allowlist limits typos " +
          "and UX, not capability. `promote` and `tombstone` are deliberately NOT " +
          "reachable here: they are human gates, run in a terminal.",
        input: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "top-level abathur command, e.g. 'genome' or 'status' or '--help'",
            },
            extra: {
              type: "array",
              items: { type: "string" },
              description: "remaining argv tokens, e.g. ['add', '/path/to/genome.jsonc']",
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
        execute: async (input: ToolInput, context: {
          progress?: (info: { status: string }) => void | Promise<void>;
        }) => {
          const command = input.command.trim();
          if (!ALLOWED_COMMANDS.includes(command)) {
            return {
              content:
                `abathur: refused '${command}' — not an allowed top-level command. ` +
                `Allowed: ${ALLOWED_COMMANDS.join(", ")}. Put the command word in 'command' ` +
                `and every other token in 'extra'.`,
            };
          }
          const argv: readonly string[] = [command, ...(input.extra ?? [])];
          if (typeof context?.progress === "function") {
            await context.progress({ status: `abathur ${argv.join(" ")}` });
          }
          const bin = resolveBin();
          const result = await runCli(bin, argv);
          const sections = [
            `$ abathur ${argv.join(" ")}`,
            `exit: ${String(result.status)}`,
          ];
          if (result.note.length > 0) sections.push(`note: ${result.note}`);
          sections.push(`--- stdout ---\n${result.stdout.length === 0 ? "(empty)" : result.stdout}`);
          sections.push(`--- stderr ---\n${result.stderr.length === 0 ? "(empty)" : result.stderr}`);
          return { content: sections.join("\n") };
        },
      });
    });
  },
};
