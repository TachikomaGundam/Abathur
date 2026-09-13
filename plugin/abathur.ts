// abathur-opencode-plugin v0.2.4
// Official opencode plugin adapter for the abathur evolution harness.
// Registers ONE agent tool, `abathur`, that shells out to the abathur CLI —
// argv-only (node:child_process execFile, never a shell), top-level commands
// restricted to an allowlist, hard timeout, capped output. The CLI itself
// remains the human gate; this adapter only lets a session *ask* abathur.
//
// V1 plugin format (opencode >= 1.14): default export { id, server }, where
// server(input, options) resolves to Hooks; Hooks.tool is a
// { [name]: ToolDefinition } record (see @opencode-ai/plugin).
// This file is shipped as-is (package.json "files") and reaches a session by
// two routes, neither compiling it through abathur's tsc. Both deliver the
// tool AND the /abathur slash command:
// (A) copied into ~/.config/opencode/plugins/ by `abathur opencode install`,
//     which also drops commands/abathur.md; "@opencode-ai/plugin" then
//     resolves in opencode's config-directory node_modules.
// (B) served as the package's "./server" export when the npm package name is
//     listed in opencode.jsonc "plugin" — opencode's arborist install places
//     @opencode-ai/plugin (runtime dependency) next to the package in its
//     cache, so the same import resolves there too; with no commands/abathur.md
//     on disk, the config hook below self-registers the command instead.

import { execFile } from "node:child_process";
import { tool, type Config } from "@opencode-ai/plugin";

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


/**
 * /abathur slash-command template, injected into cfg.command.abathur by the
 * config hook for installs without a commands/abathur.md on disk (Route B).
 * Byte-mirror of plugin/abathur-command.md minus its first-line marker —
 * src/test/opencode.test.ts pins the equality.
 */
const COMMAND_TEMPLATE = `Drive the abathur evolution harness through the \`abathur\` tool on this machine.

User request: $ARGUMENTS

Interpret the request as one \`abathur\` CLI invocation: the first word is the
top-level command (\`genome\`, \`run\`, \`status\`, \`bundle\`, \`graft\`, \`self-eval\`,
\`kernel\`, or \`--help\`) and the rest are argv tokens. Call the \`abathur\` tool
with \`command\` set to the first word and \`extra\` set to the remaining tokens,
then report the CLI exit code (0 ok / 1 blocked decision / 2 cannot-answer)
and the relevant lines of its output. If no request was given, call the tool
with \`command: "--help"\` and summarize the command list. \`promote\` and
\`tombstone\` cannot be called through the tool at all — the tool refuses them.
They are human gates that belong to a terminal: if the user asks for one,
tell them to run \`abathur promote …\` / \`abathur tombstone …\` there.
`;

export default {
  id: "abathur",
  server: async () => ({
    // Self-registering /abathur: opencode calls hook.config(cfg) once per
    // instance after ALL config sources are merged — file-based commands are
    // already in cfg.command by then (config.ts merges {command,commands}/**/*.md;
    // the hook fires from plugin/index.ts after config.get()). `??=` keeps a
    // Route-A commands/abathur.md authoritative (identical behaviour to 0.2.2)
    // and only fills the gap for Route B; the command map is keyed by name, so
    // a same-name file + injection never duplicates the entry. Proven upstream
    // mechanism: opencode-acp registers its /acp command exactly this way.
    config: async (cfg: Config) => {
      cfg.command ??= {};
      cfg.command.abathur ??= {
        description: "Drive the abathur evolution harness (usage: /abathur <command> [args...])",
        template: COMMAND_TEMPLATE,
      };
    },
    tool: {
      abathur: tool({
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
