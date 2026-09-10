// Reflection brief builder (todo 8, plan lines 133-140): pure spec + bench
// results in → mutator-facing text out. Only failed/inconclusive TRAIN units get
// detail; VAL units are referenced by opaque aliases (val-1, val-2…) — never topic
// text, file names, or scores.

import type { BenchUnit, GenomeSpec } from "../spec.js";
import type { BudgetCounters } from "../stats.js";

export interface BriefUnitEvidence {
  readonly unit: BenchUnit;
  readonly scores: readonly number[];
  /** Assertion diffs / graded failure summaries / inconclusive reasons (train only reach the brief). */
  readonly failures: readonly string[];
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/[\r\n\t]+/g, " ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function isFailing(u: BriefUnitEvidence): boolean {
  return u.failures.length > 0 || u.scores.length === 0 || u.scores.some((s) => s < 1);
}

/**
 * Reflection brief from FAILED TRAIN units only. Val units never appear with
 * identity: count + opaque aliases, no ids, no paths, no scores, no content.
 */
export function buildBrief(
  spec: GenomeSpec,
  units: readonly BriefUnitEvidence[],
  counters: BudgetCounters,
): string {
  const failing = units.filter((u) => u.unit.split === "train" && isFailing(u));
  const valCount = units.filter((u) => u.unit.split === "val").length;
  const lines: string[] = [];
  lines.push(`# Abathur mutation brief — genome "${spec.label}"`);
  lines.push("");
  lines.push(
    `Budget spent so far: candidates=${String(counters.candidates)} modelCalls=${String(counters.modelCalls)} ` +
      `tokens=${String(counters.tokens)} wallS=${String(counters.wallS)}.`,
  );
  lines.push(
    `Caps: maxCandidates=${String(spec.budget.maxCandidates)} maxModelCalls=${String(spec.budget.maxModelCalls)} ` +
      `maxTokens=${String(spec.budget.maxTokens)} maxWallS=${String(spec.budget.maxWallS)}.`,
  );
  if (failing.length === 0) {
    lines.push("", "No failing train units to reflect on this session.");
  } else {
    lines.push("", `Failing train units (${String(failing.length)}):`);
    for (const f of failing) {
      lines.push("", `## ${f.unit.path} (unit id: ${f.unit.id})`);
      lines.push(`- scores over ${String(f.scores.length)} reps: ${f.scores.map(String).join(", ")}`);
      for (const failure of f.failures) lines.push(`- failure: ${oneLine(failure, 500)}`);
    }
  }
  lines.push("", "Candidate contract: stdout JSON {candidates:[{id?,rationale,diffs:[unified-diff strings]}]}.");
  lines.push("Deletions, renames and binary hunks are refused; any kernel-immutable or artifact path in a candidate rejects the WHOLE candidate.");
  if (valCount > 0) {
    const aliases = Array.from({ length: valCount }, (_, k) => `val-${String(k + 1)}`).join(", ");
    lines.push("", `Validation split: ${String(valCount)} held-out units (${aliases}). Their topics, file names, scores and content are withheld from you by policy.`);
  }
  return `${lines.join("\n")}\n`;
}
