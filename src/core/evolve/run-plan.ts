// --dry-run plan rendering + budget-cap resolution (todo 9). Presentation of
// the resolved startup state only — the dry-run gate in run-loop.ts calls this
// AFTER the kernel audit and BEFORE any ledger/lock/spawn touch.

import path from "node:path";

import type { RegistryEntry } from "../genome.js";
import type { BudgetCaps } from "../stats.js";
import { peekPlanState } from "./run-rows.js";

export interface PlanRequest {
  readonly entry: RegistryEntry;
  readonly caps: BudgetCaps;
  readonly reps: number;
  readonly mutatorCommand: string | null;
  /** Count of spec.requires[] probes that passed in dry-run (absent = none configured). */
  readonly requiresProbed?: number | undefined;
}

/** `--max-candidates` clamps DOWN to the genome's own cap, never above. */
export function effectiveCaps(spec: RegistryEntry["spec"], clamp: number | undefined): BudgetCaps {
  const maxCandidates = Math.min(clamp ?? spec.budget.maxCandidates, spec.budget.maxCandidates);
  return {
    maxCandidates,
    maxModelCalls: spec.budget.maxModelCalls,
    maxTokens: spec.budget.maxTokens,
    maxWallS: spec.budget.maxWallS,
  };
}

export function planLines(req: PlanRequest): readonly string[] {
  const spec = req.entry.spec;
  const peek = peekPlanState(spec.repoPath);
  const specMax = spec.budget.maxCandidates;
  const unitList = spec.bench.units.map((u) => `${u.id}(${u.split})`).join(" ");
  return [
    `run plan — genome '${spec.label}' (${req.entry.fingerprint})`,
    `  repo: ${path.resolve(spec.repoPath)}`,
    `  bench: ${spec.bench.type} — timeoutS=${String(spec.bench.timeoutS)} stats minEffect=${String(spec.bench.stats.minEffect)} halfWidth=${String(spec.bench.stats.halfWidth)}`,
    `  units: ${unitList}`,
    ...(req.requiresProbed === undefined
      ? []
      : [`  requires probes: ${String(req.requiresProbed)}/${String(req.requiresProbed)} OK (prereq argv spawned; engine/mutator never spawned in dry-run)`]),
    `  reps: ${String(req.reps)}`,
    `  budget caps: maxCandidates=${String(req.caps.maxCandidates)}${req.caps.maxCandidates < specMax ? ` (clamped from ${String(specMax)})` : ""} maxModelCalls=${String(req.caps.maxModelCalls)} maxTokens=${String(req.caps.maxTokens)} maxWallS=${String(req.caps.maxWallS)}`,
    peek.lastCompleteGenId === null
      ? "  resume: no completed generation — full run"
      : `  resume: continue after completed generation ${peek.lastCompleteGenId} (${String(peek.rowCount)} generation row(s) already recorded)`,
    `  resume: incumbent bench: ${peek.incumbentHeads.length > 0 ? `present (${peek.incumbentHeads.map((h) => h.slice(0, 8)).join(", ")})` : "missing (baseline will be benched)"}`,
    `  resume: spent candidates=${String(peek.counters.candidates)} modelCalls=${String(peek.counters.modelCalls)} tokens=${String(peek.counters.tokens)} wallS=${String(peek.counters.wallS)}`,
    `  candidate source: ${req.mutatorCommand ?? "NOT CONFIGURED — a real run requires --mutator <template> (exit 2 before any spawn)"}`,
    "  kernel audit: clean (dry-run mutates nothing: no ledger touch, no lock, no reap, no spawns)",
  ];
}
