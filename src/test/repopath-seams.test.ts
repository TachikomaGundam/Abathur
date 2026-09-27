// Tripwire (postmortem 863e6c2): the env-literal repoPath defect class was
// caused by per-call-site resolution being a CONVENTION — every new FS
// consumer had to remember to call effectiveRepoPath, and promote/tombstone
// forgot for 18 days. This test makes the convention mechanical: any line
// on the command/human-gate surface that touches `spec.repoPath` must either
// resolve it through effectiveRepoPath(...) on the same line, or carry an
// inline waiver comment `raw-repoPath: <reason>` documenting WHY the raw
// stored form is correct there (display strings, self-mode literal
// detection, post-swap pipeline paths). A new command that forgets now
// fails CI instead of failing a human gate 18 days later.
//
// Scope note: engine-internal pipeline modules (src/core/evolve/**,
// src/core/graft*.ts, src/core/bundle-*.ts, src/bench/**) operate on
// candidate-worktree-swapped absolute paths by design (run-loop.ts swaps
// spec.repoPath before invoking them) and are out of scope here; the ledger
// FS seam additionally resolves unconditionally in ledgerPath().

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// dist/test/*.js -> repo src/ (tests run from the built tree but guard SOURCE).
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

const GUARDED_FILES: readonly string[] = [
  ...readdirSync(path.join(SRC, "commands"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(SRC, "commands", f)),
  path.join(SRC, "core", "promote.ts"),
  path.join(SRC, "core", "tombstone.ts"),
];

function collectHits(file: string): string[] {
  const hits: string[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!line.includes("spec.repoPath")) return;
    if (line.includes("effectiveRepoPath(")) return;
    if (line.includes("raw-repoPath:")) return;
    hits.push(`${path.relative(SRC, file)}:${String(i + 1)}: ${line.trim()}`);
  });
  return hits;
}

test("command/gate surface: every spec.repoPath use resolves via effectiveRepoPath or waives in writing", () => {
  const violations: string[] = [];
  for (const file of GUARDED_FILES) {
    if (!statSync(file, { throwIfNoEntry: false })) continue;
    violations.push(...collectHits(file));
  }
  assert.deepEqual(
    violations,
    [],
    "raw spec.repoPath uses without effectiveRepoPath() or a `raw-repoPath:` waiver:\n" +
      violations.join("\n"),
  );
});
