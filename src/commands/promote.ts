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
  // Batch-2B dual-sign: a promote needs TWO signatures — the engine gate row
  // (verdict nominated, bound by nomRowHash inside the ledger row) and THIS
  // human re-type: --confirm <genId> repeating the exact generation id.
  if (args.length !== 4 || args[2] !== "--confirm") {
    cannotAnswer(`promote: ${USAGE} --confirm <genId>  (human confirmation is the second signature; the flag must repeat the exact genId)`);
  }
  const [label, genId, , confirm] = args;
  if (label === undefined || genId === undefined || confirm === undefined || confirm !== genId) cannotAnswer(`promote: expected exactly <label> <genId>`, USAGE);
  const configDir = resolveConfigDir();
  const entry = resolveUniqueEntry(configDir, label, "promote");
  const outcome = await promoteGeneration({ entry, configDir, genId, humanConfirm: confirm });
  for (const line of outcome.lines) writeStdout(line);
  return EXIT_OK;
}

export const promoteCommand: CommandSpec = {
  name: "promote",
  summary: "human gate: promote a nominated gen (ledger-verified, sealed-path re-check, fast-forward + manifest regen)",
  run: ({ args }) => runPromote(args),
};
