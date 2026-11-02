// Anti-contamination sentry (TICKET-unit-parallel v2, checkpoint C3).
// score(unit, sandboxDir) must grade with cwd = the EXPLICIT sandbox even when the
// adapter's internal activeSandbox slot currently points at a DIFFERENT sandbox -
// exactly the interleaving concurrent unit tasks produce on one shared adapter.
// Regression shape this pins: reading activeSandbox instead of the passed dir would
// grade s2's pristine add.mjs here and the poisoned score-0 assertion fails.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { loadGenomeSpecFile } from "../core/spec.js";
import { prepareToyGenome, ToyBenchAdapter } from "../bench/toy.js";

function keep(t: TestContext, dir: string): string {
  t.after(() => {
    rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("sentry: score(unit, sandboxDir) grades the passed sandbox, not activeSandbox", async (t) => {
  const root = keep(t, await mkdtemp(path.join(os.tmpdir(), "abathur-sentry-")));
  const repo = await prepareToyGenome(path.join(root, "genome"));
  const spec = loadGenomeSpecFile(path.join(repo, "genome.jsonc"));
  const adapter = new ToyBenchAdapter(spec);
  const s1 = path.join(root, "sandbox-1");
  const s2 = path.join(root, "sandbox-2");
  await adapter.reset(s1);
  await adapter.seed(s1);
  await adapter.reset(s2);
  await adapter.seed(s2);
  const unit = spec.bench.units.find((u) => u.id === "add");
  if (unit === undefined) throw new Error("toy genome must carry an 'add' unit");
  // Same unit source, TWO truth levels: s1 gets a buggy copy (all-false checks ->
  // score 0, pass false), s2 a correct copy (all-true -> score 1). Seeding the
  // difference into the SOURCES (not the run step) keeps the assertion about WHERE
  // the grader reads from, and makes leakage detectable in BOTH directions:
  // grading s1 via s2 leaks score 1; grading s2 via s1 leaks score 0.
  await writeFile(path.join(s1, unit.path), "export function checks(){return [false,false];}\n", "utf8");
  await writeFile(path.join(s2, unit.path), "export function checks(){return [true,true];}\n", "utf8");
  // activeSandbox now points at s2 (the last touched sandbox): an adapter that reads
  // activeSandbox instead of the explicit dir grades s2 for BOTH calls.
  const poisoned = await adapter.score(unit, s1);
  assert.equal(poisoned.kind, "scored");
  if (poisoned.kind !== "scored") throw new Error("expected scored outcome");
  assert.equal(poisoned.result.score, 0, "s1 must grade s1's buggy copy");
  assert.equal(poisoned.result.pass, false);
  const clean = await adapter.score(unit, s2);
  assert.equal(clean.kind, "scored");
  if (clean.kind !== "scored") throw new Error("expected scored outcome");
  assert.equal(clean.result.score, 1, "s2 must grade s2's correct copy");
  assert.equal(clean.result.pass, true);
});
