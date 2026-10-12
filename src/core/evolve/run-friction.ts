// Friction aggregation for the run-loop (plan todo 11a): accumulates bench,
// session and verdict facts as they happen and emits ONE RunFrictionInput at
// run end. Lives outside run-loop.ts so the orchestrator stays focused; the
// loop only calls into this when the CLI injected a sink. Every string that
// reaches the queue passes through friction.ts buildRunFriction (scrub +
// bounds + val aliasing) — nothing here may add raw child output.

import type { ExitCode } from "../../exit.js";
import type { FrictionUnitEvidence, RunFrictionInput } from "./friction.js";
import type { RejectedCandidate } from "./reflect.js";
import type { GenerationVerdict, UnitMatrixRow } from "./run-rows.js";

export interface RunFrictionCollector {
  noteUnits(rows: readonly UnitMatrixRow[]): void;
  noteBench(out: { readonly units: readonly UnitMatrixRow[]; readonly complete: boolean }): void;
  noteSession(rejected: readonly RejectedCandidate[], applied: number): void;
  noteCandidate(candidateId: string, failures: readonly string[], guardNote: string | null): void;
  emit(ctx: {
    readonly genomeFp: string;
    readonly runId: string;
    readonly exit: ExitCode;
    readonly considered: readonly GenerationVerdict[];
    readonly orphanGroups: number;
  }): void;
}

export function startRunFriction(sink: (input: RunFrictionInput) => void): RunFrictionCollector {
  const units = new Map<string, FrictionUnitEvidence & { scores: number[]; failures: string[] }>();
  let rejected: { stage: string; reason: string }[] = [];
  let applied = 0;
  let benched = 0;
  let truncated = false;
  const reasons: string[] = [];

  const fold = (rows: readonly UnitMatrixRow[]): void => {
    for (const r of rows) {
      const agg = units.get(r.unitId) ?? { unitId: r.unitId, split: r.split, scores: [], failures: [] };
      agg.scores.push(...r.scores);
      agg.failures.push(...r.failures);
      units.set(r.unitId, agg);
    }
  };

  return {
    noteUnits: fold,
    noteBench(out) {
      benched += 1;
      truncated ||= !out.complete;
      fold(out.units);
    },
    noteSession(rows, appliedCount) {
      rejected = rows.map((r) => ({ stage: r.stage, reason: r.reason }));
      applied = appliedCount;
    },
    noteCandidate(candidateId, failures, guardNote) {
      if (guardNote !== null) reasons.push(`candidate ${candidateId}: self-bench guard ${guardNote}`);
      for (const f of failures) reasons.push(`candidate ${candidateId}: ${f}`);
    },
    emit(ctx) {
      const timeouts = [...units.values()].reduce(
        (n, u) => n + u.failures.filter((f) => f.includes(": run timeout") || f.includes(": run infra_failed")).length,
        0,
      );
      sink({
        genomeFp: ctx.genomeFp,
        cause: "run-summary",
        runId: ctx.runId,
        exit: ctx.exit,
        complete: !truncated,
        counts: {
          applied,
          rejected: rejected.length,
          benched,
          inconclusive: ctx.considered.filter((v) => v === "inconclusive").length,
          nominated: ctx.considered.filter((v) => v === "nominated").length,
          timeouts,
          reaped: ctx.orphanGroups,
        },
        rejected,
        units: [...units.values()],
        reasons,
        stall: { budgetTruncated: truncated, orphanGroups: ctx.orphanGroups },
      });
    },
  };
}
