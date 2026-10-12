// `abathur re-adjudicate <label> <genId>` — replay the CURRENT gate over an epoch's
// archived rows and append a corrected verdict row (with provenance). Re-judges, never
// flips by hand; promote continues to read the LAST row. See core/readjudicate.ts for
// the replay contract (counters minus own slot, bank excludes this candidate's trees).

import { resolveConfigDir } from "../config.js";
import { EXIT_OK, EXIT_CANNOT_ANSWER, cannotAnswer, type ExitCode } from "../exit.js";
import { readjudicateGeneration } from "../core/readjudicate.js";
import { writeStdout } from "../out.js";
import type { CommandSpec } from "../cli.js";
import { resolveUniqueEntry } from "./run.js";

const USAGE = "usage: abathur re-adjudicate <label> <genId>";

function runReadjudicate(args: readonly string[]): ExitCode {
  const [label, genId] = args;
  if (label === undefined || genId === undefined || args.length !== 2) cannotAnswer(`re-adjudicate: expected exactly <label> <genId>`, USAGE);
  const configDir = resolveConfigDir();
  const entry = resolveUniqueEntry(configDir, label, "re-adjudicate");
  const outcome = readjudicateGeneration({ entry, configDir, genId, now: () => new Date() });
  for (const line of outcome.lines) writeStdout(line);
  // an inconclusive replay means the gate cannot answer — surface it in the exit code,
  // matching the VERDICT_EXIT semantics of run/promote consumers.
  return outcome.verdict === "inconclusive" ? EXIT_CANNOT_ANSWER : EXIT_OK;
}

export const readjudicateCommand: CommandSpec = {
  name: "re-adjudicate",
  summary: "replay the current gate over a gen's archived rows; append corrected verdict + provenance (files stay immutable)",
  run: ({ args }) => Promise.resolve(runReadjudicate(args)),
};
