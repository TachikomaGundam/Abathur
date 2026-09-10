#!/usr/bin/env node
// CLI spine (todo 1). Every command group is a CommandSpec in COMMANDS (group
// logic lives in src/commands/<group>.ts; this file stays a thin router).
// Handlers return EXIT_OK or throw ExitSignal (see src/exit.ts) — never touch
// process themselves, so they stay unit-testable.

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundleCommand } from "./commands/bundle.js";
import { genomeCommand } from "./commands/genome.js";
import { graftCommand } from "./commands/graft.js";
import { kernelCommand } from "./commands/kernel.js";
import { promoteCommand } from "./commands/promote.js";
import { runCommand } from "./commands/run.js";
import { selfEvalCommand } from "./commands/self-eval.js";
import { statusCommand } from "./commands/status.js";
import { tombstoneCommand } from "./commands/tombstone.js";
import { ConfigError, loadConfig, type LoadedConfig } from "./config.js";
import {
  EXIT_CANNOT_ANSWER,
  EXIT_OK,
  ExitSignal,
  cannotAnswer,
  renderExitSignal,
  type ExitCode,
} from "./exit.js";

export interface CommandContext {
  readonly loaded: LoadedConfig;
  readonly args: readonly string[];
}

export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly run: (context: CommandContext) => ExitCode | Promise<ExitCode>;
}

// Router order mirrors the plan; summaries appear verbatim in --help.
export const COMMANDS: readonly CommandSpec[] = [
  genomeCommand,
  runCommand,
  statusCommand,
  promoteCommand,
  tombstoneCommand,
  bundleCommand,
  graftCommand,
  selfEvalCommand,
  kernelCommand,
];

export function usage(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  const lines = COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`).join("\n");
  return [
    "abathur — OpenCode genome evolution harness",
    "",
    "usage: abathur <command> [args...]",
    "",
    "commands:",
    lines,
    "",
    "exit codes:",
    "  0  ok / pass",
    "  1  blocked / failed (decision)",
    "  2  cannot-answer (config error, malformed input, missing engine, unimplemented)",
    "",
    "config: $ABATHUR_CONFIG > ~/.config/abathur/config.jsonc > <package>/config/abathur.jsonc,",
    "        with gitignored *.local.jsonc deep-merge overlay.",
    "",
  ].join("\n");
}

async function dispatch(argv: readonly string[]): Promise<ExitCode> {
  const [head, ...rest] = argv;
  if (head === undefined) {
    return cannotAnswer("no command given", "run 'abathur --help' for the command list");
  }
  if (head === "--help" || head === "-h" || head === "help") {
    process.stdout.write(usage());
    return EXIT_OK;
  }
  const command = COMMANDS.find((spec) => spec.name === head);
  if (command === undefined) {
    return cannotAnswer(`unknown command '${head}'`, "run 'abathur --help' for the command list");
  }
  let loaded: LoadedConfig;
  try {
    loaded = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) return cannotAnswer(error.message);
    throw error;
  }
  return await command.run({ loaded, args: rest });
}

async function main(argv: readonly string[]): Promise<void> {
  try {
    process.exitCode = await dispatch(argv);
  } catch (error) {
    if (error instanceof ExitSignal) {
      process.stderr.write(`${renderExitSignal(error)}\n`);
      process.exitCode = error.code;
      return;
    }
    // Last-resort funnel: a crash is still a "cannot-answer", never a stack dump.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`abathur: cannot answer: unexpected error: ${message}\n`);
    if (process.env.ABATHUR_DEBUG !== undefined && error instanceof Error) {
      process.stderr.write(`${error.stack ?? ""}\n`);
    }
    process.exitCode = EXIT_CANNOT_ANSWER;
  }
}

// Node passes the symlink path (npm's global bin shim) as argv[1], so compare
// realpaths — a plain resolve() made `npm i -g` installs silently no-op (todo 15
// pack→install proof). realpathSync throws for missing files; the catch keeps
// the guard false there, which is the pre-existing behavior.
let invokedDirectly = false;
try {
  invokedDirectly =
    process.argv[1] !== undefined &&
    realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) await main(process.argv.slice(2));
