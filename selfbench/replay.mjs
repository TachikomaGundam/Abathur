// Golden toy-replay (plan todo 11c): a deterministic, model-free exercise of the
// harness's own bench mechanics at HEAD, whose score digest is pinned in
// selfbench/expected.json (the TRUSTED copy). The snapshot bench re-runs THIS
// file inside the overlaid build and compares digests — a candidate that shifts
// toy-adapter behavior moves the digest and fails the val gate; tampering with
// this file or the expected digest cannot move the goalposts, because the
// scorer reads the incumbent snapshot's copy, not the candidate's.
//
// Digest contract: sha256 over canonicalJson of PURE DATA rows
//   [{unitId, rep, status, exitCode, score, pass, tokensEst, turns}]
// sorted by (unitId, rep) — no paths, no timing, no version strings. Any
// behavioral change must move it; any machine change must not.
//
// The toy mechanics are imported from the overlay's own build (dist/** via tsc,
// stub-mutators.mjs from source — tsc never copies .mjs), so the candidate under
// test is exactly what gets measured.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importFrom = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const REPLAY_SEED = 7;
const REPS = 2;

const { ToyBenchAdapter, prepareToyGenome } = await importFrom("dist/bench/toy.js");
const { loadGenomeSpecFile } = await importFrom("dist/core/spec.js");
const { canonicalJson } = await importFrom("dist/core/ids.js");
const { scriptedPatches, selectPatches, applyPatch } = await importFrom("src/core/evolve/stub-mutators.mjs");

const home = mkdtempSync(path.join(tmpdir(), "abathur-replay-"));
try {
  const genomeDir = await prepareToyGenome(path.join(home, "genome"));
  const spec = loadGenomeSpecFile(path.join(genomeDir, "genome.jsonc"));

  // Deterministic mutation storm over the seeded genome: every scripted patch,
  // in selection order, applied to the genome dir the adapter seeds from.
  for (const patch of selectPatches(REPLAY_SEED, scriptedPatches().length)) {
    applyPatch(genomeDir, patch);
  }

  const adapter = new ToyBenchAdapter(spec);
  const rows = [];
  for (let rep = 0; rep < REPS; rep += 1) {
    for (const unit of spec.bench.units) {
      const sandbox = path.join(home, "sandbox", `${unit.id}-${String(rep)}`);
      await adapter.reset(sandbox);
      await adapter.seed(sandbox);
      const run = await adapter.run(unit, sandbox, spec.bench.timeoutS);
      const score = run.status === "ok" ? await adapter.score(unit) : { kind: "inconclusive" };
      rows.push({
        unitId: unit.id,
        rep,
        status: run.status,
        exitCode: run.exitCode,
        score: score.kind === "scored" ? score.result.score : null,
        pass: score.kind === "scored" ? score.result.pass : false,
        tokensEst: run.metrics.tokensEst,
        turns: run.metrics.turns,
      });
    }
  }
  rows.sort((a, b) => (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : a.rep - b.rep));
  const digest = createHash("sha256").update(canonicalJson(rows)).digest("hex");
  process.stdout.write(`${JSON.stringify({ digest, units: rows.length })}\n`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
