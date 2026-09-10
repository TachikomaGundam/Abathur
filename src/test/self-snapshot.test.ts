// Todo 11 snapshot-overlay self-bench pins (plan 157-164). One shared TRIMMED
// harness copy (fixtures-self.ts) carries the fixture cost: it is a real git
// repo of the harness tree minus src/test, with tiny trusted tests, the seed
// genome and a captured golden-replay expected digest — the real repo is never
// touched by any bench here.
//   AC-5: golden replay digest identical across two invocations and == expected;
//   AC-4: candidate deleting a trusted test file (and editing another) ⇒ zero
//     score effect, drops reported as 'trusted-tests';
//   sealed-core candidate never overlays (AC-3 first half); the vacuous-green
//     overlay-empty guard downgrades nominations to indeterminate;
//   benign unsealed candidate overlays and stays nominated (non-degenerate);
//   broken-build candidate scores 0 and culls; hung suite is killed at cap;
//   build-timeout guard => inconclusive; timeout caps pinned;
//   run --genome abathur-self end-to-end: storm stub (sealed reject + schema
//     reject + benign candidate), ledger rows, friction digest, exit 0;
//   self-eval CLI reports verdicts/drops/digest + friction, writes no ledger.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { genId, fingerprint } from "../core/ids.js";
import { registerGenome, requireGenomesByLabel, fingerprint16, type RegistryEntry } from "../core/genome.js";
import { Ledger } from "../core/ledger.js";
import { decodeGenerationRecord, type GenerationRowData } from "../core/evolve/run-bench.js";
import { runEvolution } from "../core/evolve/run-loop.js";
import {
  DEFAULT_BUILD_TIMEOUT_S,
  DEFAULT_REPLAY_TIMEOUT_S,
  DEFAULT_TEST_TIMEOUT_S,
  SELF_BUILD_TIMEOUT,
  SELF_OVERLAY_EMPTY,
  selfBench,
  selfGuardVerdict,
  type SelfBenchResult,
} from "../core/evolve/self-snapshot.js";
import { appendRunFriction } from "../core/evolve/friction.js";
import { prepareToyGenome } from "../bench/toy.js";
import { captureReplayDigest, editFile, headSha, makeSelfHarness, seedExpectedDigest, type SelfHarness } from "./fixtures-self.js";

const HARNESS_ROOT = path.resolve(new URL("../../", import.meta.url).pathname);

export const STUB_SELF = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dir = opt("--dir");
const read = (f) => readFileSync(dir + "/" + f, "utf8");
function lineDiff(file, anchor, replacement) {
  const lines = read(file).split("\\n");
  const i = lines.findIndex((l) => l.includes(anchor));
  if (i < 0) { process.stderr.write("stub: no anchor in " + file + "\\n"); process.exit(1); }
  const changed = lines[i].replace(anchor, replacement);
  return "--- a/" + file + "\\n+++ b/" + file + "\\n@@ -" + String(i + 1) + ",1 +" + String(i + 1) + ",1 @@\\n-" + lines[i] + "\\n+" + changed + "\\n";
}
process.stdout.write(JSON.stringify({ candidates: [
  { id: "stats-tamper", rationale: "sealed-core rewrite", diffs: [lineDiff("src/core/stats.ts", "export const FAMILY_ALPHA", "export const FAMILY_ALPHA // tampered")] },
  { id: "no-diffs", rationale: "schema damage" },
  { id: "annotate-out", rationale: "comment-only unsealed edit", diffs: [lineDiff("src/out.ts", "// stdout funnel (todo 1 seam)", "// stdout funnel (todo 1 seam, patched)")] },
] }) + "\\n");
`;

interface SelfFx {
  readonly harness: SelfHarness;
  readonly head: string;
  readonly entry: RegistryEntry;
  readonly genomeFp: string;
  readonly expected: string;
  readonly incumbent: SelfBenchResult;
  readonly stub: string;
}

function selfBenchReq(fx: SelfFx, over: { genId: string; candidateCommit: string | null }) {
  return {
    spec: fx.entry.spec,
    genomeRepo: fx.harness.repo,
    genomeFp: fx.genomeFp,
    incumbentCommit: fx.head,
    candidateCommit: over.candidateCommit,
    genId: over.genId,
    reps: 2,
    env: fx.harness.env,
  } as const;
}

async function buildFixture(t: TestContext): Promise<SelfFx> {
  const harness = makeSelfHarness(t);
  mkdirSync(harness.configDir, { recursive: true });
  writeFileSync(path.join(harness.configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const digest = captureReplayDigest(harness.repo);
  const head = seedExpectedDigest(harness, digest);
  const stub = path.join(harness.root, "stub-self.mjs");
  writeFileSync(stub, STUB_SELF, "utf8");
  chmodSync(stub, 0o755);
  const saved = process.env.ABATHUR_SELF_REPO;
  try {
    process.env.ABATHUR_SELF_REPO = harness.repo;
    registerGenome(harness.configDir, harness.specPath);
    // a NON-self toy genome in the same home: self-eval must refuse to grade it.
    const toyRepo = await prepareToyGenome(path.join(harness.root, "toy-genome"));
    registerGenome(harness.configDir, path.join(toyRepo, "genome.jsonc"));
    const entry = requireGenomesByLabel(harness.configDir, "abathur-self").entries[0];
    if (entry === undefined) throw new Error("fixture: abathur-self vanished from registry");
    const genomeFp = fingerprint16(entry.spec);
    const incumbent = await selfBench({
      spec: entry.spec,
      genomeRepo: harness.repo,
      genomeFp,
      incumbentCommit: head,
      candidateCommit: null,
      genId: genId(fingerprint({ seed: head }), new Date()),
      reps: 2,
      env: harness.env,
    });
    return { harness, head, entry, genomeFp, expected: digest, incumbent, stub };
  } finally {
    if (saved === undefined) delete process.env.ABATHUR_SELF_REPO;
    else process.env.ABATHUR_SELF_REPO = saved;
  }
}

test("self-snapshot suite", async (t) => {
  const fx = await buildFixture(t);
  const saved = process.env.ABATHUR_SELF_REPO;
  process.env.ABATHUR_SELF_REPO = fx.harness.repo;
  t.after(() => {
    if (saved === undefined) delete process.env.ABATHUR_SELF_REPO;
    else process.env.ABATHUR_SELF_REPO = saved;
  });

  await t.test("fixture baseline: incumbent suite green, replay digest == trusted expected", () => {
    assert.equal(fx.incumbent.buildStatus, "ok");
    assert.equal(fx.incumbent.replayDigest, fx.expected);
    assert.equal(fx.incumbent.replayExpected, fx.expected);
    for (const run of fx.incumbent.suiteRuns) {
      assert.deepEqual([run.tests, run.fail], [4, 0]);
    }
    assert.deepEqual(fx.incumbent.dropped, []);
    assert.deepEqual(fx.incumbent.overlaid, []);
    assert.equal(fx.incumbent.complete, true);
    assert.equal(fx.incumbent.spent.modelCalls, 0);
  });

  await t.test("AC-5: golden replay digest identical across two invocations", async () => {
    const again = await selfBench(selfBenchReq(fx, { genId: genId(fingerprint({ rerun: 1 }), new Date()), candidateCommit: null }));
    const third = await selfBench(selfBenchReq(fx, { genId: genId(fingerprint({ rerun: 2 }), new Date()), candidateCommit: null }));
    assert.equal(again.replayDigest, fx.expected);
    assert.equal(third.replayDigest, fx.expected);
    assert.equal(again.replayDigest, third.replayDigest);
    assert.deepEqual(again.units.map((u) => u.scores), fx.incumbent.units.map((u) => u.scores));
  });

  await t.test("AC-4: candidate deleting a trusted test + editing another ⇒ zero score effect", async () => {
    const cand = commitSurgery(fx, "drop+edit trusted tests", () => {
      rmSync(path.join(fx.harness.repo, "src/test/self-mutators.test.ts"));
      editFile(fx.harness.repo, "src/test/self-sanity.test.ts", (s) => `${s}\n// candidate tampering\n`);
    });
    const res = await selfBench(selfBenchReq(fx, { genId: genId(fingerprint({ ac4: cand }), new Date()), candidateCommit: cand }));
    assert.ok(res.dropped.some((d) => d.path === "src/test/self-sanity.test.ts" && d.reason === "trusted-tests"));
    assert.deepEqual(res.overlaid, []);
    assert.ok(res.failures.some((f) => f.startsWith(SELF_OVERLAY_EMPTY)));
    assert.deepEqual(res.units.map((u) => u.scores), fx.incumbent.units.map((u) => u.scores));
    for (const run of res.suiteRuns) assert.deepEqual([run.tests, run.fail], [4, 0]);
    assert.equal(res.replayDigest, fx.expected);
    assert.equal(selfGuardVerdict(res.failures, "nominated"), "indeterminate");
  });

  await t.test("sealed-core candidate never overlays (stats.ts edit dropped as sealed)", async () => {
    const cand = commitSurgery(fx, "tamper sealed stats", () => {
      editFile(fx.harness.repo, "src/core/stats.ts", (s) => s.replace("export const FAMILY_ALPHA", "export const FAMILY_ALPHA // tampered"));
    });
    const res = await selfBench(selfBenchReq(fx, { genId: genId(fingerprint({ sealed: cand }), new Date()), candidateCommit: cand }));
    assert.ok(res.dropped.some((d) => d.path === "src/core/stats.ts" && d.reason === "sealed"));
    assert.deepEqual(res.overlaid, []);
    assert.equal(res.buildStatus, "ok");
    assert.equal(res.replayDigest, fx.expected);
  });

  await t.test("benign unsealed candidate overlays and stays nominated (non-degenerate)", async () => {
    const cand = commitSurgery(fx, "comment edit src/out.ts", () => {
      editFile(fx.harness.repo, "src/out.ts", (s) => s.replace("// stdout funnel (todo 1 seam)", "// stdout funnel (todo 1 seam, patched)"));
    });
    const res = await selfBench(selfBenchReq(fx, { genId: genId(fingerprint({ benign: cand }), new Date()), candidateCommit: cand }));
    assert.deepEqual(res.overlaid, ["src/out.ts"]);
    assert.deepEqual(res.dropped, []);
    assert.equal(res.buildStatus, "ok");
    assert.equal(res.replayDigest, fx.expected);
    assert.equal(selfGuardVerdict(res.failures, "nominated"), "nominated");
  });

  await t.test("broken build scores zero and culls; caps + guards pinned", async () => {
    const cand = commitSurgery(fx, "type error in out.ts", () => {
      editFile(fx.harness.repo, "src/out.ts", () => 'export const writeStdout: (t: string) => void = 42;\n');
    });
    const res = await selfBench(selfBenchReq(fx, { genId: genId(fingerprint({ broken: cand }), new Date()), candidateCommit: cand }));
    assert.equal(res.buildStatus, "failed");
    assert.ok(res.failures.some((f) => f.includes("tsc")));
    for (const u of res.units) assert.deepEqual(u.scores, [0, 0]);
    assert.equal(selfGuardVerdict(res.failures, "culled"), "culled");
    assert.equal(selfGuardVerdict([`${SELF_BUILD_TIMEOUT}: tsc killed at 180s`], "culled"), "inconclusive");
    assert.equal(selfGuardVerdict([`${SELF_OVERLAY_EMPTY}: nothing`], "nominated"), "indeterminate");
    assert.deepEqual([DEFAULT_BUILD_TIMEOUT_S, DEFAULT_TEST_TIMEOUT_S, DEFAULT_REPLAY_TIMEOUT_S], [180, 900, 120]);
  });

  await t.test("hung suite is killed at the cap: no suite samples, inconclusive", async () => {
    const cand = commitSurgery(fx, "event-loop-never-drains hang in out.ts", () => {
      editFile(fx.harness.repo, "src/out.ts", () => [
        "const keepAlive: ReturnType<typeof setInterval> = setInterval(() => {}, 60_000);",
        "void keepAlive;",
        "export function writeStdout(text: string): void {",
        "  process.stdout.write(text);",
        "}",
        "",
      ].join("\n"));
    });
    const res = await selfBench({
      ...selfBenchReq(fx, { genId: genId(fingerprint({ hung: cand }), new Date()), candidateCommit: cand }),
      testTimeoutS: 5,
      replayTimeoutS: 5,
    });
    assert.equal(res.buildStatus, "ok");
    const suite = res.units.find((u) => u.unitId === "suite");
    const replay = res.units.find((u) => u.unitId === "golden-replay");
    assert.deepEqual(suite?.scores ?? ["missing"], []);
    assert.ok(suite?.failures.some((f) => f.includes("timeout")) ?? false, JSON.stringify({ failures: suite?.failures, buildNote: res.buildNote, suiteRuns: res.suiteRuns }));
    assert.deepEqual(replay?.scores ?? ["missing"], [1, 1]); // helper runs reps: 2; replay path never imports out.js
    assert.equal(res.complete, false);
    assert.equal(selfGuardVerdict(res.failures, "nominated"), "inconclusive");
  });

  await t.test("run --genome abathur-self end-to-end: storm + benign nomination + friction digest", async () => {
    exec("git", ["-C", fx.harness.repo, "reset", "--hard", fx.head]);
    const before = ledgerCount(fx);
    const seen: Parameters<typeof appendRunFriction>[1][] = [];
    const outcome = await runEvolution({
      entry: fx.entry,
      configDir: fx.harness.configDir,
      mutatorCommand: `node ${fx.stub} --dir {worktree} --brief {brief}`,
      env: fx.harness.env,
      friction: (input) => {
        seen.push(input);
        appendRunFriction(fx.harness.configDir, input);
      },
    });
    assert.equal(seen.length, 1);
    const summary = seen[0];
    assert.equal(summary?.counts.applied, 1, "one candidate sealed through");
    assert.equal(summary?.rejected.length, 2, "both rejects carried stage+reason");
    assert.equal(summary?.counts.nominated, 1);
    assert.equal(outcome.exitCode, 0);
    assert.ok(outcome.lines.some((l) => l.includes("stats-tamper rejected (path)")), outcome.lines.join("\n"));
    assert.ok(outcome.lines.some((l) => l.includes("no-diffs rejected (schema)")));
    assert.ok(outcome.lines.some((l) => l.includes("annotate-out") && l.includes("nominated")));
    assert.equal(ledgerCount(fx), before + 2, "incumbent row + candidate row");
    const rows = candidateRows(fx);
    const cand = rows.find((r) => r.candidateId === "annotate-out");
    assert.ok(cand !== undefined && cand.verdict === "nominated");
    const queue = readFileSync(path.join(fx.harness.configDir, "friction.jsonl"), "utf8");
    assert.ok(queue.includes('"run-summary"'));
    assert.ok(!queue.includes("stats-tamper"), "candidateId strings are not required in the digest");
  });

  await t.test("self-eval CLI reports verdict + drops + digest, appends friction, writes no ledger", () => {
    const genRow = latestGenIdFor(fx, "annotate-out");
    const before = ledgerCount(fx);
    const run = spawnSync(process.execPath, [path.join(HARNESS_ROOT, "dist/cli.js"), "self-eval", "--genome", "abathur-self", "--gen", genRow, "--reps", "2"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ABATHUR_CONFIG: path.join(fx.harness.configDir, "config.jsonc"),
        ABATHUR_SELF_REPO: fx.harness.repo,
        HOME: path.join(fx.harness.root, "home"),
        XDG_CACHE_HOME: path.join(fx.harness.root, "xdg-selfeval"),
      },
      timeout: 280_000,
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.ok(run.stdout.includes("verdict nominated"), run.stdout);
    assert.ok(run.stdout.includes(fx.expected), "trusted replay digest surfaces in the report");
    assert.ok(/overlay \d+|overlaid/.test(run.stdout), run.stdout);
    assert.equal(ledgerCount(fx), before, "self-eval never writes ledger rows");
    const queue = readFileSync(path.join(fx.harness.configDir, "friction.jsonl"), "utf8");
    assert.ok(queue.includes('"self-eval"'));
  });

  await t.test("self-eval refuses a non-self genome and an unknown label (exit 2)", () => {
    const spawnEval = (label: string): { status: number | null; stderr: string } =>
      spawnSync(process.execPath, [path.join(HARNESS_ROOT, "dist/cli.js"), "self-eval", "--genome", label], {
        encoding: "utf8",
        env: {
          ...process.env,
          ABATHUR_CONFIG: path.join(fx.harness.configDir, "config.jsonc"),
          ABATHUR_SELF_REPO: fx.harness.repo,
          HOME: path.join(fx.harness.root, "home"),
          XDG_CACHE_HOME: path.join(fx.harness.root, "xdg-selfeval2"),
        },
      });
    const nonSelf = spawnEval("toy-smoke");
    assert.equal(nonSelf.status, 2, nonSelf.stderr);
    assert.match(nonSelf.stderr, /self-eval/);
    const ghost = spawnEval("missing-label");
    assert.equal(ghost.status, 2, ghost.stderr);
    assert.match(ghost.stderr, /no registered genome/); // registry-wide convention (run.test.ts:545)
  });
});

// ------------------------------------------------------------------ utilities

function commitSurgery(fx: SelfFx, message: string, surgery: () => void): string {
  // every candidate branches off the incumbent HEAD — earlier subtests'
  // surgeries must not stack into later candidates' diffs.
  exec("git", ["-C", fx.harness.repo, "reset", "--hard", fx.head]);
  surgery();
  const repo = fx.harness.repo;
  exec("git", ["-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "-C", repo, "add", "-A"]);
  exec("git", ["-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "-C", repo, "commit", "-m", message]);
  return headSha(repo);
}

function exec(bin: string, args: string[]): void {
  const r = spawnSync(bin, args, { encoding: "utf8", stdio: "pipe" });
  if (r.status !== 0) throw new Error(`${bin} failed: ${r.stderr}`);
}

function ledgerCount(fx: SelfFx): number {
  const file = path.join(fx.harness.repo, ".state/abathur/ledger.jsonl");
  try {
    return readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.includes('"generation_complete"')).length;
  } catch {
    return 0;
  }
}

function candidateRows(fx: SelfFx): GenerationRowData[] {
  const ledger = Ledger.open(fx.harness.repo);
  return ledger
    .readAll()
    .filter((r) => r.kind === "generation_complete")
    .map((r) => decodeGenerationRecord(r))
    .filter((d) => d.source === "candidate");
}

function latestGenIdFor(fx: SelfFx, candidateId: string): string {
  const ledger = Ledger.open(fx.harness.repo);
  let found = "";
  for (const r of ledger.readAll()) {
    if (r.kind !== "generation_complete" || r.genId === undefined) continue;
    const data = decodeGenerationRecord(r);
    if (data.source === "candidate" && data.candidateId === candidateId) found = r.genId;
  }
  if (found === "") throw new Error(`no ${candidateId} candidate row`);
  return found;
}
