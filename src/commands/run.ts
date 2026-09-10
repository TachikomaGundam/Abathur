// `abathur run` — thin CLI edge (plan todo 9): flag parsing + registry lookup +
// stdout funnel only; every gate and the whole evolution loop live in
// src/core/evolve/run-loop.ts (runEvolution), so the loop stays unit-testable.

import { resolveConfigDir } from "../config.js";
import { readRegistry, requireGenomesByLabel, type RegistryEntry } from "../core/genome.js";
import { appendRunFriction, type RunFrictionInput } from "../core/evolve/friction.js";
import { runEvolution } from "../core/evolve/run-loop.js";
import { cannotAnswer, ExitSignal, type ExitCode } from "../exit.js";
import type { CommandContext, CommandSpec } from "../cli.js";
import { writeStdout } from "../out.js";

const USAGE =
  "usage: abathur run --genome <label> [--reps N] [--max-candidates N] [--mutator <template>] [--dry-run] [--include-val]";

interface RunFlags {
  readonly label: string;
  readonly reps: number | null;
  readonly maxCandidates: number | null;
  readonly mutator: string | null;
  readonly dryRun: boolean;
  /**
   * Operator val EXPOSURE switch: surfaces val scenario ids/paths in this
   * run's bench manifest (the loop always benches val replicates internally);
   * rejected with exit 2 on benches that cannot honour it.
   */
  readonly includeVal: boolean;
}

function positiveInt(raw: string | undefined, flag: string): number {
  if (raw === undefined || raw.length === 0 || raw.startsWith("--")) {
    cannotAnswer(`run: ${flag} requires a positive integer value`, USAGE);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    cannotAnswer(`run: ${flag} expects a positive integer, got '${raw}'`, USAGE);
  }
  return value;
}

export function parseRunFlags(args: readonly string[]): RunFlags {
  let label: string | null = null;
  let reps: number | null = null;
  let maxCandidates: number | null = null;
  let mutator: string | null = null;
  let dryRun = false;
  let includeVal = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const next = (): string | undefined => args[(i += 1)];
    switch (arg) {
      case "--genome": {
        const raw = next();
        if (raw === undefined || raw.length === 0 || raw.startsWith("--")) {
          cannotAnswer("run: --genome <label> requires a value", USAGE);
        }
        label = raw;
        break;
      }
      case "--reps":
        reps = positiveInt(next(), "--reps");
        break;
      case "--max-candidates":
        maxCandidates = positiveInt(next(), "--max-candidates");
        break;
      case "--mutator": {
        const raw = next();
        if (raw === undefined || raw.length === 0 || raw.startsWith("--")) cannotAnswer("run: --mutator <template> requires a value", USAGE);
        mutator = raw;
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--include-val":
        includeVal = true;
        break;
      default:
        cannotAnswer(`run: unknown flag ${arg}`, USAGE);
    }
  }
  if (label === null) cannotAnswer("run: --genome <label> is required", USAGE);
  return { label, reps, maxCandidates, mutator, dryRun, includeVal };
}

/** Labels are free (todo 4): a command needs ONE genome, so duplicates are an explicit exit 2. */
export function resolveUniqueEntry(configDir: string, label: string, who = "run"): RegistryEntry {
  const scan = requireGenomesByLabel(configDir, label);
  if (scan.entries.length > 1) {
    cannotAnswer(
      `${who}: label '${label}' is ambiguous — ${String(scan.entries.length)} genomes share it: ${scan.entries
        .map((e) => `${e.fingerprint} @ ${e.spec.repoPath}`)
        .join(", ")}`,
      "give the specs distinct labels; the fingerprint is the identity",
    );
  }
  const entry = scan.entries[0];
  if (entry === undefined) cannotAnswer(`${who}: no registered genome with label '${label}'`);
  return entry;
}

const ZERO_COUNTS = { applied: 0, rejected: 0, benched: 0, inconclusive: 0, nominated: 0, timeouts: 0, reaped: 0 };

async function runRun(context: CommandContext): Promise<ExitCode> {
  const flags = parseRunFlags(context.args);
  const configDir = resolveConfigDir();
  for (const warning of readRegistry(configDir).warnings) writeStdout(`warning: ${warning}`);
  const entry = resolveUniqueEntry(configDir, flags.label);
  const warnings: string[] = [];
  const frictionSink = (input: RunFrictionInput): void => {
    try {
      appendRunFriction(configDir, input);
    } catch (error) {
      warnings.push(`friction: append failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  // Friction is the self-evolution SIGNAL channel (todo 11): every real run
  // books one structured run-summary record, and every refusal that happens
  // after the registry resolved books a cli-error record — in both cases the
  // queue append can never break or change the run's own exit status.
  let outcome;
  try {
    outcome = await runEvolution({
      entry,
      configDir,
      opencodeBin: context.loaded.config.opencodeBin,
      ...(flags.reps === null ? {} : { reps: flags.reps }),
      ...(flags.maxCandidates === null ? {} : { maxCandidates: flags.maxCandidates }),
      ...(flags.mutator === null ? {} : { mutatorCommand: flags.mutator }),
      ...(flags.dryRun ? { dryRun: true } : {}),
      ...(flags.includeVal ? { includeVal: true } : {}),
      friction: frictionSink,
    });
  } catch (error) {
    if (error instanceof ExitSignal) {
      try {
        appendRunFriction(configDir, {
          genomeFp: entry.fingerprint,
          cause: "cli-error",
          exit: error.code,
          complete: false,
          counts: ZERO_COUNTS,
          rejected: [],
          units: [],
          reasons: [error.message],
          stall: { budgetTruncated: false, orphanGroups: 0 },
        });
      } catch {
        // the refusal stands on its own; a dead queue never masks it.
      }
    }
    throw error;
  }
  for (const line of outcome.lines) writeStdout(line);
  for (const warning of warnings) writeStdout(warning);
  return outcome.exitCode;
}

export const runCommand: CommandSpec = {
  name: "run",
  summary: "evolve one genome: observe, mutate, re-bench, select",
  run: (context) => runRun(context),
};
