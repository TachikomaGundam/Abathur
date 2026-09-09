#!/usr/bin/env node
// CLI spine (todo 1). Extension seam for todos 2-15: each group below is a
// CommandSpec in COMMANDS; replace the `pending(...)` entry with a real handler
// (put group logic in src/commands/<group>.ts, keep this file a thin router).
// Handlers return EXIT_OK or throw ExitSignal (see src/exit.ts) — never touch
// process themselves, so they stay unit-testable.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { genomeCommand } from "./commands/genome.js";
import { kernelCommand } from "./commands/kernel.js";
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

function pending(name: string, summary: string): CommandSpec {
  return {
    name,
    summary,
    run: () => cannotAnswer(`command group '${name}' is not implemented yet`, summary),
  };
}

// Router order mirrors the plan; summaries appear verbatim in --help.
export const COMMANDS: readonly CommandSpec[] = [
  genomeCommand,
  pending("run", "evolve one genome: observe, mutate, re-bench, select"),
  pending("status", "ledger and proposal state for a genome"),
  pending("promote", "human-gate: accept a candidate mutation"),
  pending("tombstone", "human-gate: refuse and bury a candidate"),
  pending("bundle", "export a genome + lineage as an offline bundle"),
  pending("graft", "import an offline bundle and graft its lineage"),
  pending("self-eval", "evaluate the harness itself (abathur-self genome)"),
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

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main(process.argv.slice(2));
