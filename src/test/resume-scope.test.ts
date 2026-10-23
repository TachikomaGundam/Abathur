// Regression guard (contamination incident 2026-10-22): incumbent resume rows were keyed
// ONLY by headCommit, so a row benched under a different genome SPEC (roster/grader/window)
// on the same HEAD was silently reused by the next flight — toy-roster rows poisoned real
// PCB flights for 12h. Rows now carry the benching spec fingerprint (genomeFp) and resume
// only matches rows with the identical fingerprint; legacy rows (no fingerprint) never
// satisfy a scoped read (fail-closed: they force a fresh re-bench, never a stale reuse).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { LEDGER_KIND_GENERATION_COMPLETE, Ledger } from "../core/ledger.js";
import { readResume, type GenerationRowData } from "../core/evolve/run-rows.js";

function row(headCommit: string, genomeFp?: string): GenerationRowData {
  return {
    source: "incumbent",
    headCommit,
    ...(genomeFp === undefined ? {} : { genomeFp }),
    complete: true,
    reps: 2,
    units: [{ unitId: "s31b-r-e", split: "train", scores: [0.7, 0.7], runIds: ["r1", "r2"], failures: [] }],
    counters: { candidates: 0, modelCalls: 0, tokens: 0, wallS: 3600 },
    manifest: [],
    benchProvenance: { benchType: "opencode-fixture-scenarios", versions: [] },
  } as GenerationRowData;
}

function freshLedger(): Ledger {
  const dir = mkdtempSync(path.join(tmpdir(), "abathur-resume-scope-"));
  return Ledger.open(path.join(dir, "repo"));
}

test("resume only reuses incumbent rows benched under the identical genome spec", () => {
  const ledger = freshLedger();
  ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId: "g1", runId: "i1", data: row("HEAD1", "fpA") });
  assert.equal(readResume(ledger, "fpA").incumbentByHead.size, 1, "matching spec reuses");
  assert.equal(readResume(ledger, "fpB").incumbentByHead.size, 0, "different spec must NOT reuse");
  assert.equal(readResume(ledger, "fpB").counters.wallS, 3600, "budget counters still accrue across specs");
});

test("legacy rows without a fingerprint never satisfy a scoped read (fail-closed)", () => {
  const ledger = freshLedger();
  ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId: "g0", runId: "i0", data: row("HEAD1") });
  assert.equal(readResume(ledger, "fpA").incumbentByHead.size, 0, "unscoped legacy row must not resume");
  assert.ok(readResume(ledger).incumbentByHead.has("HEAD1"), "unscoped read stays backward-compatible");
});

test("candidate dedup is scope-filtered the same way", () => {
  const ledger = freshLedger();
  const c = { ...row("HEAD1", "fpA"), source: "candidate", candidateId: "c1", commitSha: "c0", treeSha: "t1" } as GenerationRowData;
  ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId: "g2", runId: "i1", data: c });
  assert.equal(readResume(ledger, "fpA").candidatesByTree.size, 1);
  assert.equal(readResume(ledger, "fpB").candidatesByTree.size, 0);
});
