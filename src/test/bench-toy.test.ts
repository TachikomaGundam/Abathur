// Todo 5 acceptance pins (adapter-level only — the CLI `run` lives in todo 9):
// (a) seed→run→score cycle; (b) identical seed ⇒ identical score matrix;
// (c) state-mutating unit ⇒ reset restores the exact pre-state digest;
// (d) grader exit-1 ⇒ inconclusive-for-unit, never a crash;
// (e) hanging unit ⇒ process-group kill + recorded timeout status.
// Plan-literal: toy path needs no opencode, no network, no absolute machine paths.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { ExitSignal } from "../exit.js";
import { treeDigestAt } from "../core/ids.js";
import { loadGenomeSpecFile, type BenchUnit, type GenomeSpec } from "../core/spec.js";
import { applyPatch, scriptedPatches } from "../core/evolve/stub-mutators.mjs";
import {
  type RunResult,
  type ScoreOutcome,
  type ScoreResult,
} from "../bench/adapter.js";
import { prepareToyGenome, ToyBenchAdapter } from "../bench/toy.js";

// ------------------------------------------------------------------- fixtures

function keep(t: TestContext, dir: string): string {
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function freshDir(t: TestContext, prefix: string): Promise<string> {
  return keep(t, await mkdtemp(path.join(os.tmpdir(), `abathur-${prefix}-`)));
}

interface ToyFixture {
  readonly genomeDir: string;
  readonly spec: GenomeSpec;
}

/** Self-init toy genome: tmp copy + git repo + repoPath rewritten (init.mjs contract). */
async function toyFixture(t: TestContext): Promise<ToyFixture> {
  const genomeDir = path.join(await freshDir(t, "toygerm"), "toy-smoke");
  await prepareToyGenome(genomeDir);
  return { genomeDir, spec: loadGenomeSpecFile(path.join(genomeDir, "genome.jsonc")) };
}

function unitById(spec: GenomeSpec, id: string): BenchUnit {
  const unit = spec.bench.units.find((u) => u.id === id);
  if (unit === undefined) throw new Error(`fixture spec has no unit '${id}'`);
  return unit;
}

function scored(outcome: ScoreOutcome): ScoreResult {
  if (outcome.kind === "scored") return outcome.result;
  assert.fail(`expected scored, got inconclusive: ${outcome.reason}`);
}

interface MatrixRow {
  readonly unitId: string;
  readonly run: RunResult;
  readonly score: ScoreOutcome;
}

async function scoreMatrix(spec: GenomeSpec, sandboxDir: string): Promise<MatrixRow[]> {
  const adapter = new ToyBenchAdapter(spec);
  await adapter.reset(sandboxDir);
  await adapter.seed(sandboxDir);
  const rows: MatrixRow[] = [];
  for (const unit of spec.bench.units) {
    rows.push({
      unitId: unit.id,
      run: await adapter.run(unit, sandboxDir, spec.bench.timeoutS),
      score: await adapter.score(unit),
    });
  }
  return rows;
}

// ------------------------------------------------------------------ AC (a)

test("(a) seed→run→score cycle: ok statuses, provenance, metrics, val+train gradable", async (t) => {
  const { genomeDir, spec } = await toyFixture(t);
  const sandbox = await freshDir(t, "toysbx");
  const adapter = new ToyBenchAdapter(spec);
  await adapter.reset(sandbox);
  await adapter.seed(sandbox);

  const rows = new Map<string, { run: RunResult; score: ScoreOutcome }>();
  for (const unit of spec.bench.units) {
    rows.set(unit.id, {
      run: await adapter.run(unit, sandbox, spec.bench.timeoutS),
      score: await adapter.score(unit),
    });
  }
  for (const { run } of rows.values()) {
    assert.equal(run.status, "ok");
    assert.equal(run.benchProvenance.benchType, "toy");
    assert.deepEqual(run.benchProvenance.versions, [{ bin: "node", version: process.version }]);
    assert.equal(run.metrics.turns, 1);
    assert.ok(run.metrics.tokensEst >= 1);
  }
  // a non-zero unit exit is an observation on an ok run, not an infra failure
  assert.equal(rows.get("explode")?.run.exitCode, 1);
  assert.equal(rows.get("add")?.run.exitCode, 0);
  assert.equal(rows.get("add")?.run.note, undefined);

  assert.equal(scored(rows.get("add")!.score).score, 0); // seeded bug is graded
  assert.equal(scored(rows.get("add")!.score).pass, false);
  assert.equal(scored(rows.get("mul")!.score).score, 1);
  assert.equal(scored(rows.get("sub")!.score).pass, true); // val unit gradable
  const mulBytes = readFileSync(path.join(sandbox, "units", "mul.mjs")).length;
  assert.equal(rows.get("mul")?.run.metrics.tokensEst, Math.ceil(mulBytes / 4));

  assert.ok(existsSync(path.join(genomeDir, ".git")), "init.mjs must self-create the git repo");
  assert.equal(spec.repoPath, genomeDir); // repoPath rewritten to the tmp copy
});

// ------------------------------------------------------------------ AC (b)

test("(b) identical seed ⇒ identical score matrix (determinism)", async (t) => {
  const { spec } = await toyFixture(t);
  const matrixA = await scoreMatrix(spec, await freshDir(t, "toysbx"));
  const matrixB = await scoreMatrix(spec, await freshDir(t, "toysbx"));
  assert.deepEqual(matrixA, matrixB);
  assert.equal(matrixA.length, spec.bench.units.length);
});

// ------------------------------------------------------------------ AC (c)

test("(c) reset+seed undoes unit state mutation — digest before run 2 == run 1", async (t) => {
  const { spec } = await toyFixture(t);
  const sandbox = await freshDir(t, "toysbx");
  const adapter = new ToyBenchAdapter(spec);
  await adapter.reset(sandbox);
  await adapter.seed(sandbox);
  const preDigest = treeDigestAt(sandbox);

  const mutate: BenchUnit = { id: "mutate", path: "units/mutate.mjs", split: "train" };
  const run1 = await adapter.run(mutate, sandbox, spec.bench.timeoutS);
  assert.equal(run1.status, "ok");
  assert.ok(existsSync(path.join(sandbox, "poison.txt")), "mutating unit must dirty the sandbox");
  assert.notEqual(treeDigestAt(sandbox), preDigest);

  await adapter.reset(sandbox);
  await adapter.seed(sandbox);
  assert.ok(!existsSync(path.join(sandbox, "poison.txt")));
  assert.equal(treeDigestAt(sandbox), preDigest); // exact pre-state restored

  const run2 = await adapter.run(mutate, sandbox, spec.bench.timeoutS);
  assert.deepEqual(run2, run1); // identical pre-state ⇒ identical observation
});

// ------------------------------------------------------------------ AC (d)

test("(d) grader exit-1 unit ⇒ inconclusive-for-unit, not a crash", async (t) => {
  const { spec } = await toyFixture(t);
  const sandbox = await freshDir(t, "toysbx");
  const adapter = new ToyBenchAdapter(spec);
  await adapter.reset(sandbox);
  await adapter.seed(sandbox);

  const outcome = await adapter.score(unitById(spec, "explode"));
  assert.equal(outcome.kind, "inconclusive");
  if (outcome.kind === "inconclusive") {
    assert.equal(outcome.unitId, "explode");
    assert.match(outcome.reason, /grader exited 1/);
  }
  // a scored sibling in the same sandbox proves the bench never died with the grader
  assert.equal(scored(await adapter.score(unitById(spec, "mul"))).pass, true);

  // stale-state guard: scoring with no sandbox ever seeded/run is a tool error (exit 2)
  const cold = new ToyBenchAdapter(spec);
  await assert.rejects(
    () => cold.score(unitById(spec, "mul")),
    (cause: unknown) => cause instanceof ExitSignal && cause.code === 2,
  );
});

test("(d2) malformed grader output degrades to inconclusive, never a parse crash", async (t) => {
  const { spec } = await toyFixture(t);
  // tamper the SANDBOX copy of the grader (fixture repo itself stays sealed-clean)
  const sandbox = await freshDir(t, "toysbx");
  const adapter = new ToyBenchAdapter(spec);
  await adapter.reset(sandbox);
  await adapter.seed(sandbox);
  await writeFile(path.join(sandbox, "grader.mjs"), 'process.stdout.write("not json at all\\n");\n', "utf8");
  const outcome = await adapter.score(unitById(spec, "mul"));
  assert.equal(outcome.kind, "inconclusive");
  if (outcome.kind === "inconclusive") assert.ok(outcome.reason.length > 0);
});

// ------------------------------------------------------------------ AC (e)

test("(e) hanging unit: process-group SIGKILL at timeoutS, recorded not thrown", async (t) => {
  const { spec } = await toyFixture(t);
  const sandbox = await freshDir(t, "toysbx");
  const adapter = new ToyBenchAdapter(spec);
  await adapter.reset(sandbox);
  await adapter.seed(sandbox);

  const hang: BenchUnit = { id: "hang", path: "units/hang.mjs", split: "train" };
  const startedMs = Date.now();
  const run = await adapter.run(hang, sandbox, 1);
  const elapsedMs = Date.now() - startedMs;

  assert.equal(run.status, "timeout");
  assert.equal(run.exitCode, null);
  assert.deepEqual(run.metrics, { tokensEst: 0, turns: 0 });
  assert.match(run.note ?? "", /killed after 1s: process group SIGKILL/);
  assert.ok(elapsedMs < 6000, `timeout path took ${String(elapsedMs)}ms`);

  // group kill must have reaped the exec'd grandchild, not just node itself
  const ps = spawnSync("ps", ["-eo", "args"], { encoding: "utf8" });
  assert.equal(ps.status, 0);
  assert.ok(!ps.stdout.includes("sleep 31.7"), `orphaned 'sleep 31.7' survived the kill`);
});

// ----------------------------------------------------- infra / hooks / render

test("missing runner binary records infra_failed with a reason, excluded not zeroed", async (t) => {
  const { spec } = await toyFixture(t);
  const broken: GenomeSpec = {
    ...spec,
    bench: { ...spec.bench, runCommand: "abathur-no-such-bin {unit.path}" },
  };
  const sandbox = await freshDir(t, "toysbx");
  const adapter = new ToyBenchAdapter(broken);
  await adapter.reset(sandbox);
  await adapter.seed(sandbox);
  const run = await adapter.run(unitById(spec, "mul"), sandbox, 5);
  assert.equal(run.status, "infra_failed");
  assert.equal(run.exitCode, null);
  assert.match(run.note ?? "", /spawn failed/);
});

test("seedCommand / resetCommand hooks execute inside the sandbox when configured", async (t) => {
  const { spec } = await toyFixture(t);
  const hooked: GenomeSpec = {
    ...spec,
    bench: { ...spec.bench, seedCommand: "touch seeded.flag", resetCommand: "touch reset.flag" },
  };
  const sandbox = path.join(await freshDir(t, "toysbx"), "nested"); // mkdir -p path
  const adapter = new ToyBenchAdapter(hooked);
  await adapter.reset(sandbox);
  await adapter.seed(sandbox);
  assert.ok(existsSync(path.join(sandbox, "reset.flag")), "resetCommand must run after the wipe");
  assert.ok(existsSync(path.join(sandbox, "seeded.flag")));
});


// -------------------------------------------------------------- stub-mutators


test("stub-mutators: applyPatch refuses missing/ambiguous anchors; fix-add lifts the score", async (t) => {
  const { genomeDir, spec } = await toyFixture(t);
  const scratch = await freshDir(t, "mutscratch");
  await writeFile(path.join(scratch, "dup.txt"), "x\nx\n", "utf8");
  assert.equal(applyPatch(scratch, { file: "dup.txt", from: "x", to: "y" }), false); // ambiguous
  assert.equal(applyPatch(scratch, { file: "nope.txt", from: "x", to: "y" }), false); // missing
  assert.equal(readFileSync(path.join(scratch, "dup.txt"), "utf8"), "x\nx\n"); // nothing written

  const fix = scriptedPatches().find((p) => p.id === "fix-add");
  if (fix === undefined) throw new Error("fix-add patch missing from table");
  const sandbox = await freshDir(t, "toysbx");
  const adapter = new ToyBenchAdapter(spec);
  await adapter.reset(sandbox);
  await adapter.seed(sandbox);
  assert.equal(scored(await adapter.score(unitById(spec, "add"))).score, 0); // before: seeded bug
  assert.equal(applyPatch(genomeDir, fix), true);
  await adapter.reset(sandbox);
  await adapter.seed(sandbox);
  assert.equal(scored(await adapter.score(unitById(spec, "add"))).score, 1); // after: evolved

  // re-apply of the same patch is a no-op refusal (anchor already rewritten)
  assert.equal(applyPatch(genomeDir, fix), false);
});

// ------------------------------------------------------------------ self-init

test("init.mjs is idempotent: re-init keeps the git repo and rewrites repoPath", async (t) => {
  const { genomeDir } = await toyFixture(t);
  const head = (): string => {
    const run = spawnSync("git", ["rev-parse", "HEAD"], { cwd: genomeDir, encoding: "utf8" });
    assert.equal(run.status, 0);
    return (run.stdout ?? "").trim();
  };
  const before = head();
  await prepareToyGenome(genomeDir); // .git already exists ⇒ must NOT re-init
  assert.equal(head(), before);
});

test("prepareToyGenome creates missing parent dirs (regression: missing cwd masquerades as spawn ENOENT)", async (t) => {
  const dest = path.join(await freshDir(t, "toyparent"), "missing", "nested-g");
  await prepareToyGenome(dest);
  assert.ok(existsSync(path.join(dest, "genome.jsonc")));
  assert.ok(existsSync(path.join(dest, ".git")));
  const head = (): string => {
    const run = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dest, encoding: "utf8" });
    assert.equal(run.status, 0);
    return (run.stdout ?? "").trim();
  };
  const before = head();
  await prepareToyGenome(dest); // same dest again ⇒ still idempotent, .git preserved
  assert.equal(head(), before);
});
