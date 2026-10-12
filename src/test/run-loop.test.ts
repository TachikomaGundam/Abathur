// Todo 9 AC pins (plan lines 141-148): resumable run-loop orchestrator.
//   AC(a) toy 2-candidate run end-to-end exit 0 + generation_complete ledger rows;
//   resume exactly-once: a truncated ledger (crash before a row commits) reruns the
//   missing bench only — same samples, budget counters never double;
//   AC(d) --dry-run prints the plan, mutates NOTHING (path-absence + no mkdir);
//   AC(c) budget maxTokens=1 ⇒ inconclusive exit 2 (stats short-circuit, gain null);
//   cancellation: --max-candidates clamps the session to exactly N benched candidates;
//   AC(e) tampered kernel file ⇒ startup refusal exit 1 before any state exists;
//   dirty target paths ⇒ openGenome refusal exit 1 before any generation spawns;
//   orphan reaper: live dead-run groups SIGKILLed; malformed/own-pid records skipped;
//   ChildTracker: append-before-exec + removal on exit; adapter onChild hook.
// No model calls anywhere: toy genome + runtime-written stub mutator only.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { ExitSignal } from "../exit.js";
import { loadConfig } from "../config.js";
import { registerGenome, requireGenomesByLabel } from "../core/genome.js";
import { Ledger, ledgerPath } from "../core/ledger.js";
import type { GenomeSpec } from "../core/spec.js";
import type { RegistryEntry } from "../core/genome.js";
import type { WorktreeEnv } from "../core/genome-paths.js";
import {
  decodeGenerationRecord,
  type GenerationRowData,
} from "../core/evolve/run-bench.js";
import {
  runEvolution,
  type RunLoopOutcome,
} from "../core/evolve/run-loop.js";
import {
  activeChildrenPath,
  readChildRecords,
  reapOrphans,
  ChildTracker,
} from "../core/evolve/child-track.js";
import { prepareToyGenome, ToyBenchAdapter } from "../bench/toy.js";
import { runChild } from "../bench/adapter.js";
import { runCommand } from "../commands/run.js";

// ------------------------------------------------------------------- stubs

// Same three-candidate script as reflect.test.ts mode "three": annotate-add seals,
// touch-kernel is rejected (path policy), fix-add seals. The fix moves the train
// aggregate 0.5 -> 1.0 (gain = minEffect 0.5) and val 'sub' stays 1.0 ⇒ nominated.
const ADD_ANCHOR = "return a - b; // seeded bug: must be `return a + b;`";
const STUB_SOURCE = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const mode = opt("--mode");
const dir = opt("--dir");
const read = (f) => readFileSync(dir + "/" + f, "utf8");
function lineDiff(file, anchor, replacement) {
  const lines = read(file).split("\\n");
  const i = lines.findIndex((l) => l.includes(anchor));
  if (i < 0) { process.stderr.write("stub: no anchor in " + file + "\\n"); process.exit(1); }
  const changed = lines[i].replace(anchor, replacement);
  return "--- a/" + file + "\\n+++ b/" + file + "\\n@@ -" + String(i + 1) + ",1 +" + String(i + 1) + ",1 @@\\n-" + lines[i] + "\\n+" + changed + "\\n";
}
const FIX = ${JSON.stringify(ADD_ANCHOR)};
const out = (candidates) => process.stdout.write(JSON.stringify({ candidates }) + "\\n");
if (mode === "three") {
  out([
    { id: "annotate-add", rationale: "annotate add()", diffs: [lineDiff("units/add.mjs", "export function add(", "export function add /* patched */(")] },
    { id: "touch-kernel", rationale: "subvert grading", diffs: [lineDiff("grader.mjs", "model-free", "model-free-ish")] },
    { id: "fix-add", rationale: "fix add(): subtraction to addition", diffs: [lineDiff("units/add.mjs", FIX, "return a + b;")] },
  ]);
} else {
  process.stderr.write("stub: unknown mode\\n");
  process.exit(2);
}
`;

// ----------------------------------------------------------------- fixtures

interface LoopFixture {
  readonly root: string;
  readonly configDir: string;
  readonly repo: string;
  readonly spec: GenomeSpec;
  readonly entry: RegistryEntry;
  readonly mutatorCommand: string;
  readonly env: WorktreeEnv;
  readonly sandboxRoot: string;
  readonly xdgRoot: string;
}

/** Fresh tmp home: config dir + registered toy genome + stub mutator, all isolated. */
async function loopFixture(
  t: TestContext,
  tune?: { readonly maxTokens?: number },
): Promise<LoopFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "abathur-runloop-"));
  t.after(() => {
    // worktree dirs are git-administered; plain recursive rm is enough here.
    spawnSync("rm", ["-rf", root], { encoding: "utf8" });
  });
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");

  const repo = await prepareToyGenome(path.join(root, "genome"));
  if (tune?.maxTokens !== undefined) {
    const specPath = path.join(repo, "genome.jsonc");
    const doc = JSON.parse(readFileSync(specPath, "utf8")) as {
      budget: { maxTokens: number };
    };
    doc.budget.maxTokens = tune.maxTokens;
    writeFileSync(specPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  }
  registerGenome(configDir, path.join(repo, "genome.jsonc"));
  const entry = requireGenomesByLabel(configDir, "toy-smoke").entries[0];
  if (entry === undefined) throw new Error("fixture: toy-smoke registration vanished");

  const stub = path.join(root, "stub.mjs");
  writeFileSync(stub, STUB_SOURCE, "utf8");
  chmodSync(stub, 0o755);
  return {
    root,
    configDir,
    repo,
    spec: entry.spec,
    entry,
    mutatorCommand: `node ${stub} --mode three --dir {worktree} --brief {brief}`,
    env: { XDG_CACHE_HOME: path.join(root, "xdg-cache"), HOME: path.join(root, "home") },
    sandboxRoot: path.join(root, "sandboxes"),
    xdgRoot: path.join(root, "xdg-cache"),
  };
}

function generationRows(f: LoopFixture): GenerationRowData[] {
  const ledger = Ledger.open(f.repo);
  return ledger
    .readAll()
    .filter((r) => r.kind === "generation_complete")
    .map((r) => decodeGenerationRecord(r));
}

function candidateRows(f: LoopFixture): GenerationRowData[] {
  return generationRows(f).filter((d) => d.source === "candidate");
}

function scoredSamples(rows: readonly GenerationRowData[]): number {
  return rows.reduce(
    (acc, d) => acc + d.units.reduce((a, u) => a + u.scores.length, 0),
    0,
  );
}

function spentTokens(rows: readonly GenerationRowData[]): number {
  return rows.reduce((acc, d) => acc + d.counters.tokens, 0);
}

function truncateLastLine(filePath: string): void {
  const lines = readFileSync(filePath, "utf8").split("\n").filter((l) => l.length > 0);
  lines.pop();
  writeFileSync(filePath, lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
}

async function expectExitSignal(code: 1 | 2, pattern: RegExp, run: Promise<unknown>): Promise<ExitSignal> {
  await assert.rejects(run, (cause: unknown) => {
    assert.ok(cause instanceof ExitSignal, `expected ExitSignal, got ${String(cause)}`);
    assert.equal(cause.code, code);
    assert.match(cause.message, pattern);
    return true;
  });
  return (await run.catch((c: unknown) => c)) as ExitSignal;
}

function runEvolutionFor(
  f: LoopFixture,
  opts: {
    readonly reps?: number;
    readonly maxCandidates?: number;
    readonly dryRun?: boolean;
    readonly mutatorCommand?: string | null;
  } = {},
): Promise<RunLoopOutcome> {
  const mutator =
    opts.mutatorCommand === null ? undefined : opts.mutatorCommand ?? f.mutatorCommand;
  return runEvolution({
    entry: f.entry,
    configDir: f.configDir,
    ...(opts.reps === undefined ? {} : { reps: opts.reps }),
    ...(opts.maxCandidates === undefined ? {} : { maxCandidates: opts.maxCandidates }),
    ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }),
    ...(mutator === undefined ? {} : { mutatorCommand: mutator }),
    env: f.env,
    sandboxRoot: f.sandboxRoot,
  });
}

// ------------------------------------------------------------------ AC (a)

test("AC(a): toy run benches incumbent + 2 candidates, fix-add nominated, exit 0", async (t) => {
  const f = await loopFixture(t);
  const out = await runEvolutionFor(f);
  assert.equal(out.exitCode, 0, `expected exit 0, lines: ${out.lines.join("\n")}`);

  const rows = generationRows(f);
  const incumbents = rows.filter((d) => d.source === "incumbent");
  assert.equal(incumbents.length, 1, "exactly one incumbent baseline row");
  assert.equal(incumbents[0]?.complete, true);
  assert.equal(incumbents[0]?.reps, 2, "default reps = nReps.initial");

  const cands = candidateRows(f);
  assert.deepEqual(
    cands.map((d) => d.candidateId).sort(),
    ["annotate-add", "fix-add"],
    "touch-kernel was rejected by the path policy, never benched",
  );
  const fix = cands.find((d) => d.candidateId === "fix-add");
  const annotate = cands.find((d) => d.candidateId === "annotate-add");
  assert.equal(fix?.verdict, "nominated", `fix-add: ${fix?.gateFailures?.join("; ")}`);
  assert.equal(annotate?.verdict, "culled");
  assert.ok(fix !== undefined && typeof fix.gain === "number" && fix.gain >= 0.5);

  // per-unit matrix: add/mul scored on train, sub scored on val, explode excluded
  // (grader inconclusive => failures, never a fabricated 0 score).
  for (const row of cands) {
    const byId = new Map(row.units.map((u) => [u.unitId, u]));
    assert.deepEqual(byId.get("add")?.scores, row.candidateId === "fix-add" ? [1, 1] : [0, 0]);
    assert.deepEqual(byId.get("mul")?.scores, [1, 1]);
    assert.deepEqual(byId.get("sub")?.scores, [1, 1], "val unit benched for the gate");
    assert.equal(byId.get("explode")?.scores.length, 0, "inconclusive unit carries no score");
    assert.ok((byId.get("explode")?.failures.length ?? 0) > 0, "inconclusive recorded as failure note");
    assert.equal(row.complete, true);
    assert.equal(row.counters.candidates, 1);
    assert.equal(typeof row.treeSha, "string");
    assert.match(row.treeSha ?? "", /^[0-9a-f]{40}$/);
    assert.ok(row.manifest.some((m) => m.path === "grader.mjs"), "kernel manifest in the record");
    assert.equal(row.benchProvenance.benchType, "toy");
    assert.ok(row.benchProvenance.versions.length > 0);
    assert.ok(
      row.units.flatMap((u) => u.runIds).every((id) => id.startsWith("r-g-")),
      "runIds are ids.runId(g-…) shaped",
    );
  }

  // exactly-once bookkeeping: 3 targets x (add,mul,sub = 3 scored units) x 2 reps.
  assert.equal(scoredSamples(rows), 18);
  assert.ok(spentTokens(rows) > 0);

  // every tracked child was removed on normal exit; the log file was created though.
  assert.deepEqual(readChildRecords(f.repo), [], "active-children emptied on clean exit");
});

// ------------------------------------------------------- resume exactly-once

test("resume: truncated last row re-benches only the missing tree, counters never double", async (t) => {
  const f = await loopFixture(t);
  const first = await runEvolutionFor(f);
  assert.equal(first.exitCode, 0);
  const cleanRows = generationRows(f);
  const cleanSamples = scoredSamples(cleanRows);
  const cleanTokens = spentTokens(cleanRows);

  // simulate SIGKILL after the annotate row committed but before the fix-add row:
  truncateLastLine(ledgerPath(f.repo));
  assert.deepEqual(candidateRows(f).map((d) => d.candidateId), ["annotate-add"]);

  const again = await runEvolutionFor(f);
  assert.equal(again.exitCode, 0, again.lines.join("\n"));

  const rows = generationRows(f);
  const cands = candidateRows(f);
  assert.equal(cands.length, 2, "exactly two candidate generations after resume");
  assert.deepEqual(
    new Set(cands.map((d) => d.candidateId)).size,
    2,
    "no duplicate candidate generations",
  );
  assert.equal(rows.filter((d) => d.source === "incumbent").length, 1, "incumbent not re-benched");
  assert.equal(scoredSamples(rows), cleanSamples, "score samples after resume == clean run");
  assert.equal(spentTokens(rows), cleanTokens, "budget counters never double");
});

test("resume: third invocation of a finished run adds no generation rows at all", async (t) => {
  const f = await loopFixture(t);
  await runEvolutionFor(f);
  const before = generationRows(f);
  const out = await runEvolutionFor(f, { maxCandidates: 2 });
  assert.equal(out.exitCode, 0, out.lines.join("\n"));
  const after = generationRows(f);
  assert.equal(after.length, before.length, "every candidate tree was already in the ledger");
  assert.equal(spentTokens(after), spentTokens(before));

  // Full-budget rerun: remaining > 0 so the session runs, but the driver slices
  // the batch BEFORE our dedup — the recorded fix-add never re-delivers. The
  // stored nominated verdict must still carry into the exit status (else a
  // completed run flips to exit 1 on every rerun).
  const wide = await runEvolutionFor(f);
  assert.equal(wide.exitCode, 0, wide.lines.join("\n"));
  assert.ok(
    wide.lines.some((l) => /carried into this run's exit status/.test(l)),
    wide.lines.join("\n"),
  );
  assert.equal(generationRows(f).length, before.length, "carry reporting benches nothing new");
});

// ---------------------------------------------------------- AC (d) --dry-run

test("AC(d): --dry-run prints the full plan and mutates nothing", async (t) => {
  const f = await loopFixture(t, { maxTokens: 999999 });
  const out = await runEvolutionFor(f, { dryRun: true, maxCandidates: 1 });
  assert.equal(out.exitCode, 0);
  const plan = out.lines.join("\n");
  assert.match(plan, /genome 'toy-smoke'/);
  assert.match(plan, /bench: toy/);
  assert.match(plan, /units: add\(train\) mul\(train\) explode\(train\) sub\(val\)/);
  assert.match(plan, /reps: 2/);
  assert.match(plan, /maxCandidates=1 \(clamped from 4\)/);
  assert.match(plan, /maxTokens=\d+/);
  assert.match(plan, /resume: no completed generation/);
  assert.match(plan, /incumbent bench: missing/);
  assert.match(plan, /candidate source: node .* --mode three/);

  // absence proof: none of the run's mutable state was created at all.
  assert.equal(existsSync(ledgerPath(f.repo)), false, "dry-run created no ledger file");
  assert.equal(existsSync(activeChildrenPath(f.repo)), false, "dry-run touched no child log");
  assert.equal(existsSync(path.join(f.configDir, ".locks")), false, "dry-run took no lock");
  assert.equal(existsSync(f.xdgRoot), false, "dry-run spawned no worktree");
  assert.equal(existsSync(path.join(f.repo, ".state")), false, "dry-run did not mkdir .state");

  // and the same fixture still runs for real afterwards (dry left nothing behind).
  const real = await runEvolutionFor(f);
  assert.equal(real.exitCode, 0, real.lines.join("\n"));
  assert.ok(candidateRows(f).length > 0);
});

// ---------------------------------------------------------- AC (c) budget-exhaust

test("AC(c): maxTokens=1 ⇒ inconclusive exit 2, gain null, never a zero-score pass", async (t) => {
  const f = await loopFixture(t, { maxTokens: 1 });
  const out = await runEvolutionFor(f);
  assert.equal(out.exitCode, 2, `budget exhaustion must be cannot-answer, lines: ${out.lines.join("\n")}`);
  assert.match(out.lines.join("\n"), /budget exhausted: tokens=/);

  const cands = candidateRows(f);
  assert.ok(cands.length > 0, "spent candidates are booked in the ledger even when truncated");
  for (const row of cands) {
    assert.equal(row.verdict, "inconclusive");
    assert.equal(row.gain, null, "inconclusive never fabricates an effect size");
    assert.equal(row.complete, false);
    assert.ok(row.gateFailures?.some((msg) => /budget exhausted: tokens=/.test(msg)));
  }
  assert.ok(
    cands.every((d) => d.units.every((u) => u.scores.length === 0)),
    "truncated benches carry no fabricated score samples",
  );
  assert.ok(!generationRows(f).some((d) => d.verdict === "nominated"));
});

// ------------------------------------------------------ cancellation + clamp

test("cancellation: --max-candidates 1 benches exactly one candidate and finishes", async (t) => {
  const f = await loopFixture(t);
  const out = await runEvolutionFor(f, { maxCandidates: 1 });
  const cands = candidateRows(f);
  assert.equal(cands.length, 1, "session clamped to the cap: one applied candidate");
  assert.equal(cands[0]?.candidateId, "annotate-add");
  assert.equal(out.exitCode, cands[0]?.verdict === "culled" ? 1 : out.exitCode);
  // cap reached ⇒ a second run spends nothing more.
  const second = await runEvolutionFor(f, { maxCandidates: 1 });
  assert.match(second.lines.join("\n"), /cap 1 already spent/);
  assert.equal(candidateRows(f).length, 1);
});

// ------------------------------------------------------------ AC (e) kernel tamper

test("AC(e): tampered kernel file refuses the run at startup, exit 1, nothing exists", async (t) => {
  const f = await loopFixture(t);
  writeFileSync(path.join(f.repo, "grader.mjs"), `${readFileSync(path.join(f.repo, "grader.mjs"), "utf8")}// tampered\n`, "utf8");
  await expectExitSignal(1, /kernel drift/i, runEvolutionFor(f));
  // refusal precedes every side effect: no ledger, no child log, no lock, no worktree.
  assert.equal(existsSync(ledgerPath(f.repo)), false);
  assert.equal(existsSync(activeChildrenPath(f.repo)), false);
  assert.equal(existsSync(path.join(f.configDir, ".locks")), false);
  assert.equal(existsSync(f.xdgRoot), false);
});

test("dirty target path: run refuses before any generation exists, exit 1", async (t) => {
  const f = await loopFixture(t);
  const addPath = path.join(f.repo, "units", "add.mjs");
  writeFileSync(addPath, `${readFileSync(addPath, "utf8")}// local uncommitted edit\n`, "utf8");
  await expectExitSignal(1, /dirty target path/i, runEvolutionFor(f));
  assert.deepEqual(Ledger.open(f.repo).readAll(), [], "refusal happened before any row appended");
  assert.equal(existsSync(activeChildrenPath(f.repo)), false, "nothing was ever spawned");
  assert.equal(existsSync(f.xdgRoot), false);
});

// ---------------------------------------------------------------- reaper unit

test("reap: malformed, own-pid and dead-pid records are skipped/truncated without kills", (_t) => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "abathur-reap-bad-"));
  try {
    const log = activeChildrenPath(repo);
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(
      log,
      [
        "this is not json {{{",
        JSON.stringify({ pid: process.pid, pgid: process.pid, genId: "g-mine", kind: "bench-run", at: "2026-09-09T00:00:00.000Z" }),
        JSON.stringify({ pid: 4_199_999, pgid: 4_199_999, genId: "g-dead", kind: "bench-run", at: "2026-09-09T00:00:00.000Z" }),
        JSON.stringify({ pid: -3, genId: "g-bogus" }),
      ].join("\n") + "\n",
      "utf8",
    );
    const report = reapOrphans(repo);
    // Both the unparseable line and the structurally invalid record (pid -3)
    // are malformed: the reaper refuses to interpret them, counts them, and moves on.
    assert.equal(report.malformed, 2, "unparseable + invalid-pid lines counted as malformed");
    assert.ok(report.skipped.some((s) => s.includes("self")), "own pid skipped");
    assert.equal(report.skipped.some((s) => s.includes("bogus")), false, "invalid records are malformed, never killed");
    assert.ok(report.reaped.some((r) => r.pid === 4_199_999), "dead group still SIGKILLed (ESRCH no-op)");
    assert.equal(readFileSync(log, "utf8").length, 0, "log truncated after reap");
    process.kill(process.pid, 0); // still alive — the reap never touches unrecorded/self pids
  } finally {
    spawnSync("rm", ["-rf", repo]);
  }
});

test("reap: a live orphan process group from a dead run is SIGKILLed", async (t) => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "abathur-reap-live-"));
  const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000); process.title = 'abathur-reap-e2e-sleeper';"], {
    detached: true,
    stdio: "ignore",
  });
  t.after(() => {
    try {
      if (sleeper.pid !== undefined) process.kill(-sleeper.pid, "SIGKILL");
    } catch {
      /* already reaped */
    }
    spawnSync("rm", ["-rf", repo]);
  });
  const pid = sleeper.pid;
  assert.ok(pid !== undefined);
  sleeper.unref();
  await waitForAlive(pid, true);

  const log = activeChildrenPath(repo);
  mkdirSync(path.dirname(log), { recursive: true });
  writeFileSync(
    log,
    `${JSON.stringify({ v: 1, pid, pgid: pid, genId: "g-orphan", kind: "bench-run", at: new Date().toISOString() })}\n`,
    "utf8",
  );
  const report = reapOrphans(repo);
  assert.deepEqual(report.reaped, [{ pid, alive: true }]);
  await waitForAlive(pid, false);
  assert.equal(readFileSync(log, "utf8").length, 0);
});

async function waitForAlive(pid: number, expectAlive: boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive === expectAlive) return;
    if (Date.now() > deadline) assert.fail(`pid ${String(pid)} never became ${expectAlive ? "alive" : "dead"}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// ---------------------------------------------------------------- tracker

test("tracker: entries appear before exec and vanish once the child exits", async (t) => {
  const repo = await (async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "abathur-track-"));
    t.after(() => spawnSync("rm", ["-rf", dir]));
    return dir;
  })();
  const tracker = new ChildTracker(repo);
  tracker.phase("g-track", "bench-run");
  const outcome = await runChild({
    argv: [process.execPath, "-e", "console.log('hi')"],
    cwd: repo,
    timeoutS: 10,
    onChild: tracker.onChild,
  });
  assert.equal(outcome.kind, "exited");
  // the record existed while the child was alive:
  // (runChild resolves after close; removal is queued on the same event — drain first)
  await tracker.drain();
  assert.deepEqual(readChildRecords(repo), [], "record removed after exit");
  assert.equal(existsSync(activeChildrenPath(repo)), true, "the log file itself persists (append-only discipline)");
});

test("onChild hook: ToyBenchAdapter reports every spawn it makes", async (t) => {
  const f = await loopFixture(t);
  const handles: { pid: number; exited: Promise<void> }[] = [];
  const adapter = new ToyBenchAdapter(f.spec, {
    onChild: (h) => {
      handles.push(h);
    },
  });
  const sandboxRoot = path.join(f.root, "hook-sandbox");
  await adapter.reset(sandboxRoot);
  await adapter.seed(sandboxRoot);
  const unit = f.spec.bench.units.find((u) => u.id === "add");
  assert.ok(unit !== undefined);
  const run = await adapter.run(unit, sandboxRoot, 10);
  assert.equal(run.status, "ok");
  const score = await adapter.score(unit);
  assert.equal(score.kind, "scored");
  assert.ok(handles.length >= 2, "run + grader children both reported");
  await Promise.all(handles.map((h) => h.exited));
});

// ---------------------------------------------------------------- CLI wiring

test("CLI: run wiring — arg misuse is exit 2, help line preserved", async (t) => {
  const f = await loopFixture(t);
  const configFile = path.join(f.configDir, "config.jsonc");
  const loaded = loadConfig({ ABATHUR_CONFIG: configFile });
  const saved = process.env["ABATHUR_CONFIG"];
  process.env["ABATHUR_CONFIG"] = configFile; // runRun resolves the config dir from the real env
  t.after(() => {
    if (saved === undefined) delete process.env["ABATHUR_CONFIG"];
    else process.env["ABATHUR_CONFIG"] = saved;
  });
  const ctx = { loaded, args: [] as string[] };
  await expectExitSignal(2, /--genome/, Promise.resolve(runCommand.run(ctx)));
  await expectExitSignal(2, /unknown flag --nope/, Promise.resolve(runCommand.run({ loaded, args: ["--genome", "toy-smoke", "--nope"] })));
  await expectExitSignal(2, /--reps/, Promise.resolve(runCommand.run({ loaded, args: ["--genome", "toy-smoke", "--reps", "abc"] })));
  await expectExitSignal(2, /--mutator/, Promise.resolve(runCommand.run({ loaded, args: ["--genome", "toy-smoke", "--mutator", "--oops"] })));
  await expectExitSignal(2, /no registered genome/, Promise.resolve(runCommand.run({ loaded, args: ["--genome", "ghost"] })));
  // --include-val parses, threads into the loop, and fails closed on the toy bench:
  await expectExitSignal(
    2,
    /--include-val is only supported by the opencode-fixture-scenarios bench/,
    Promise.resolve(runCommand.run({ loaded, args: ["--genome", "toy-smoke", "--include-val", "--dry-run"] })),
  );
  const out = await runCommand.run({ loaded, args: ["--genome", "toy-smoke", "--dry-run"] });
  assert.equal(out, 0);
});
