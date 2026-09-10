// `abathur promote <label> <genId>` — the ONLY entry point to the human gate
// (plan Must NOT: no auto-promote path importable by evolve modules). No --force:
// every refusal is a bug report, not a flag.

import { resolveConfigDir } from "../config.js";
import { EXIT_OK, cannotAnswer, type ExitCode } from "../exit.js";
import { promoteGeneration } from "../core/promote.js";
import { writeStdout } from "../out.js";
import type { CommandSpec } from "../cli.js";
import { resolveUniqueEntry } from "./run.js";

const USAGE = "usage: abathur promote <label> <genId>";

async function runPromote(args: readonly string[]): Promise<ExitCode> {
  const [label, genId] = args;
  if (label === undefined || genId === undefined || args.length !== 2) cannotAnswer(`promote: expected exactly <label> <genId>`, USAGE);
  const configDir = resolveConfigDir();
  const entry = resolveUniqueEntry(configDir, label, "promote");
  const outcome = await promoteGeneration({ entry, configDir, genId });
  for (const line of outcome.lines) writeStdout(line);
  return EXIT_OK;
}

export const promoteCommand: CommandSpec = {
  name: "promote",
  summary: "human gate: promote a nominated gen (ledger-verified, sealed-path re-check, fast-forward + manifest regen)",
  run: ({ args }) => runPromote(args),
};
