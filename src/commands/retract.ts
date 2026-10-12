// `abathur retract <label> <genId> --reason <text>` — the human gate that
// undoes a promote (core in core/retract.ts, imported ONLY here — the
// import-policy pin lives in src/test/promote.test.ts). Terminal-only like
// promote/tombstone: the opencode plugin tool must never reach it. No --force:
// every refusal is a bug report, not a flag.

import { resolveConfigDir } from "../config.js";
import { EXIT_OK, cannotAnswer, type ExitCode } from "../exit.js";
import { retractGeneration } from "../core/retract.js";
import { writeStdout } from "../out.js";
import type { CommandSpec } from "../cli.js";
import { resolveUniqueEntry } from "./run.js";

const USAGE = "usage: abathur retract <label> <genId> --reason <text>";
const MAX_REASON_CHARS = 500;

async function runRetract(args: readonly string[]): Promise<ExitCode> {
  const positional: string[] = [];
  let reason: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === "--reason") {
      const value = args[(i += 1)];
      if (value === undefined || value.startsWith("--")) cannotAnswer("retract: --reason requires a value", USAGE);
      if (reason !== null) cannotAnswer("retract: --reason given twice", USAGE);
      reason = value;
    } else if (arg.startsWith("--")) {
      cannotAnswer(`retract: unknown flag ${arg}`, USAGE);
    } else {
      positional.push(arg);
    }
  }
  const [label, genId] = positional;
  if (label === undefined || genId === undefined || positional.length !== 2) {
    cannotAnswer("retract: expected exactly <label> <genId> --reason <text>", USAGE);
  }
  if (reason === null || reason.trim().length === 0) {
    cannotAnswer("retract: --reason <text> is required (why is this promote being undone?)", USAGE);
  }
  if (reason.length > MAX_REASON_CHARS) cannotAnswer(`retract: --reason exceeds ${String(MAX_REASON_CHARS)} chars`, USAGE);

  const configDir = resolveConfigDir();
  const entry = resolveUniqueEntry(configDir, label, "retract");
  const outcome = await retractGeneration({ entry, configDir, genId, reason });
  for (const line of outcome.lines) writeStdout(line);
  return EXIT_OK;
}

export const retractCommand: CommandSpec = {
  name: "retract",
  summary: "human gate: undo a promote (LIFO, descendant-guarded; append-only row, ref deleted, manifest cleared)",
  run: ({ args }) => runRetract(args),
};
