// F1-fix2 loop-level regression pins for the val-split bench authority split
// (plan lines 117-124 / 125-132 / SC4). Commit 3c6bbf9 wired `--include-val` at
// the fixture adapter seam but left benchTarget iterating EVERY unit, so any
// default `run` on a val-bearing fixture genome crashed mid-bench with
//   ExitSignal(2) "fixture: unit 'v1' is a val-split scenario and requires the
//   operator flag --include-val"
// at the first val unit — the SC4/T7 flagship flows were unreachable without the
// flag. Pins here:
//  (1) default run (NO flag) completes: incumbent AND candidate benches carry
//      scored val replicates (the nomination gate's required input);
//  (2) --include-val stays the honest operator EXPOSURE switch: off, every
//      sandbox manifest keeps val ids/paths opaque; on, they surface;
//  (3) toy + flag fail-closed stays pinned in include-val.test.ts / run-loop.test.ts.
// No model calls anywhere: fake opencodeBin bash stub + node grader table.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { registerGenome, requireGenomesByLabel, type RegistryEntry } from "../core/genome.js";
import { Ledger } from "../core/ledger.js";
import type { WorktreeEnv } from "../core/genome-paths.js";
import { decodeGenerationRecord, type GenerationRowData } from "../core/evolve/run-bench.js";
import { runEvolution, type RunLoopOutcome } from "../core/evolve/run-loop.js";

// --------------------------------------------------------------------- stubs

const VAL_CANARY = "sval-canary-ZZHIDDEN";
const VAL_PATH = `scenarios/${VAL_CANARY}.md`;

// Fake opencode: `--version` semver line (probe), `run <path>` scenario echo +
// final run-metadata JSON line (same contract as bench-fixture.test.ts BIN_GOOD).
const FAKE_BIN = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--version" ]; then echo "1.2.3"; exit 0; fi
if [ -n "\${ABATHUR_TRANSCRIPT:-}" ]; then
  mkdir -p "$(dirname "$ABATHUR_TRANSCRIPT")"
  printf 'ran %s\\n' "\${2:-}" > "$ABATHUR_TRANSCRIPT"
fi
echo "ran \${2:-}"
echo '{"tokensEst":10,"turns":1}'
`;

const GRADER = `const [unitId] = process.argv.slice(2);
const table = {
  t1: { score: 1, pass: true },
  v1: { score: 0.75, pass: true },
};
const row = table[unitId];
if (!row) { console.error("unknown unit " + unitId); process.exit(1); }
console.log(JSON.stringify({ unit: unitId, score: row.score, pass: row.pass, metrics: { tokensEst: 4, turns: 1 } }));
`;

const RESET_SH = `#!/usr/bin/env bash
set -euo pipefail
rm -rf "\${1:?sandbox}"
mkdir -p "\${1:?sandbox}"
`;

const SEED_SH = `#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
sandbox="\${1:?sandbox}"
mkdir -p "$sandbox/scenarios"
cp "$here"/scenarios/*.md "$sandbox/scenarios/"
cp "$here"/grader.mjs "$sandbox/grader.mjs"
`;

// Two modes: "garbage" delivers one syntactically invalid candidate (rejected at
// parse, never benched — the loop exits after the incumbent bench); "touch"
// delivers a valid non-improving diff against the train scenario so the CANDIDATE
// bench (the second val-bearing seam) runs too and the gate culls it.
const MUTATOR_STUB = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const mode = opt("--mode");
const dir = opt("--dir");
const out = (candidates) => process.stdout.write(JSON.stringify({ candidates }) + "\\n");
if (mode === "garbage") {
  out([{ id: "garbage-1", rationale: "not a real diff", diffs: ["this is not a unified diff\\n"] }]);
} else if (mode === "touch") {
  const file = "scenarios/t1.md";
  const lines = readFileSync(dir + "/" + file, "utf8").split("\\n");
  const i = lines.findIndex((l) => l.includes("train alpha"));
  if (i < 0) { process.stderr.write("stub: no anchor in " + file + "\\n"); process.exit(1); }
  const changed = lines[i].replace("train alpha", "train alpha (annotated)");
  const diff = "--- a/" + file + "\\n+++ b/" + file +
    "\\n@@ -" + String(i + 1) + ",1 +" + String(i + 1) + ",1 @@\\n-" + lines[i] + "\\n+" + changed + "\\n";
  out([{ id: "touch-t1", rationale: "annotate the train scenario without changing scores", diffs: [diff] }]);
} else {
  process.stderr.write("stub: unknown mode\\n");
  process.exit(2);
}
`;

// ------------------------------------------------------------------ fixtures

interface FixtureLoop {
  readonly root: string;
  readonly configDir: string;
  readonly repo: string;
  readonly entry: RegistryEntry;
  readonly env: WorktreeEnv;
  readonly sandboxRoot: string;
  readonly stub: string;
}

function git(repo: string, args: readonly string[]): void {
  const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
}

/** Git-init'd fixture-scenario genome (train t1 + val v1) registered in a fresh config dir. */
async function fixtureLoop(t: TestContext): Promise<FixtureLoop> {
  const root = await mkdtemp(path.join(os.tmpdir(), "abathur-fixloop-"));
  t.after(() => spawnSync("rm", ["-rf", root], { encoding: "utf8" }));

  const binDir = path.join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, "oc-fake");
  writeFileSync(binPath, FAKE_BIN, "utf8");
  chmodSync(binPath, 0o755);

  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  // opencodeBin resolution flows loadConfig(env) with env = the loop's WorktreeEnv
  // ({HOME, XDG_CACHE_HOME} only), so the fake HOME carries the user config file
  // — the bench adapter then spawns the fake bin, never a real opencode.
  const userConfigDir = path.join(root, "home", ".config", "abathur");
  mkdirSync(userConfigDir, { recursive: true });
  writeFileSync(path.join(userConfigDir, "config.jsonc"), `${JSON.stringify({ opencodeBin: binPath })}\n`, "utf8");

  const repo = path.join(root, "germ");
  mkdirSync(path.join(repo, "scenarios"), { recursive: true });
  writeFileSync(path.join(repo, "scenarios", "t1.md"), "train alpha scenario\nsecond line\n", "utf8");
  writeFileSync(path.join(repo, "scenarios", `${VAL_CANARY}.md`), "holdout val scenario ZZHIDDEN\n", "utf8");
  writeFileSync(path.join(repo, "grader.mjs"), GRADER, "utf8");
  for (const [name, body] of [
    ["reset.sh", RESET_SH],
    ["seed.sh", SEED_SH],
  ] as const) {
    const p = path.join(repo, name);
    writeFileSync(p, body, "utf8");
    chmodSync(p, 0o755);
  }
  const specDoc = {
    label: "fixloop-germ",
    repoPath: repo,
    bench: {
      type: "opencode-fixture-scenarios",
      units: [
        { id: "t1", path: "scenarios/t1.md", split: "train" },
        { id: "v1", path: VAL_PATH, split: "val" },
      ],
      runCommand: `${binPath} run {unit.path}`,
      seedCommand: `${repo}/seed.sh {sandbox}`,
      resetCommand: `${repo}/reset.sh {sandbox}`,
      graderCommand: "node grader.mjs {unit.id}",
      agentModel: "test/agent",
      timeoutS: 10,
      stats: { halfWidth: 0.1, minEffect: 0.05, nReps: { initial: 2, max: 4 } },
    },
    budget: { maxCandidates: 2, maxModelCalls: 8, maxTokens: 100000, maxWallS: 300 },
    kernel: { immutableGlobs: [] },
    requires: [{ cmd: "node", args: ["--version"], probeExit: 0 }],
    opencodeBinVersion: { minVersion: "1.0.0" },
  };
  const specPath = path.join(repo, "genome.jsonc");
  writeFileSync(specPath, `${JSON.stringify(specDoc, null, 2)}\n`, "utf8");
  git(repo, ["init", "-b", "main"]);
  git(repo, ["add", "-A"]);
  // identity pinned via -c BEFORE the subcommand (toy init.mjs convention)
  git(repo, ["-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "commit", "-m", "fixloop seed"]);

  registerGenome(configDir, specPath);
  const entry = requireGenomesByLabel(configDir, "fixloop-germ").entries[0];
  if (entry === undefined) throw new Error("fixture: fixloop-germ registration vanished");

  const stub = path.join(root, "stub.mjs");
  writeFileSync(stub, MUTATOR_STUB, "utf8");
  chmodSync(stub, 0o755);

  return {
    root,
    configDir,
    repo,
    entry,
    env: {
      HOME: path.join(root, "home"),
      XDG_CACHE_HOME: path.join(root, "xdg-cache"),
    },
    sandboxRoot: path.join(root, "sandboxes"),
    stub,
  };
}

function loopRun(
  f: FixtureLoop,
  opts: { readonly includeVal?: boolean; readonly mode: "garbage" | "touch" },
): Promise<RunLoopOutcome> {
  return runEvolution({
    entry: f.entry,
    configDir: f.configDir,
    mutatorCommand: `node ${f.stub} --mode ${opts.mode} --dir {worktree} --brief {brief}`,
    ...(opts.includeVal === undefined ? {} : { includeVal: opts.includeVal }),
    env: f.env,
    sandboxRoot: f.sandboxRoot,
  });
}

function generations(repo: string): GenerationRowData[] {
  return Ledger.open(repo)
    .readAll()
    .filter((r) => r.kind === "generation_complete")
    .map((r) => decodeGenerationRecord(r));
}

interface ManifestScenario {
  readonly alias: string;
  readonly split: string;
  readonly id?: string;
  readonly path?: string;
}

function manifestsUnder(dir: string): readonly string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name === "manifest.json") found.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return found;
}

function valEntry(manifestFile: string): ManifestScenario {
  const doc = JSON.parse(readFileSync(manifestFile, "utf8")) as { scenarios: readonly ManifestScenario[] };
  const entry = doc.scenarios.find((s) => s.split === "val");
  assert.ok(entry !== undefined, `manifest ${manifestFile} must count the val scenario`);
  return entry;
}

// ---------------------------------------------------------------- pin (1): RED at 3c6bbf9

test("regression: default run (NO --include-val) benches val replicates and completes", async (t) => {
  const f = await fixtureLoop(t);
  const out = await loopRun(f, { mode: "garbage" });
  assert.equal(out.exitCode, 0, `loop must complete, lines: ${out.lines.join("\n")}`);
  assert.match(out.lines.join("\n"), /incumbent baseline: 2 units x 2 reps/);

  const rows = generations(f.repo);
  const incumbent = rows.filter((d) => d.source === "incumbent");
  assert.equal(incumbent.length, 1, "exactly one incumbent baseline row");
  const byId = new Map(incumbent[0]?.units.map((u) => [u.unitId, u]));
  assert.deepEqual(byId.get("t1")?.scores, [1, 1], "train unit scored");
  assert.equal(byId.get("v1")?.split, "val");
  assert.deepEqual(byId.get("v1")?.scores, [0.75, 0.75], "val unit benched under loop authority");
  assert.equal(incumbent[0]?.complete, true);

  // exposure OFF: the val id/path stay opaque in every sandbox manifest the bench wrote
  const manifests = manifestsUnder(f.sandboxRoot);
  assert.ok(manifests.length >= 2, `expected per-unit bench manifests, found ${String(manifests.length)}`);
  for (const m of manifests) {
    const raw = readFileSync(m, "utf8");
    assert.ok(!raw.includes(VAL_CANARY), `val path leaked into ${m} without the operator flag`);
    const val = valEntry(m);
    assert.equal(val.id, undefined, "val id must stay hidden without the operator flag");
    assert.equal(val.path, undefined, "val path must stay hidden without the operator flag");
  }
});

// --------------------------------------------------- pin (2): --include-val is real

test("--include-val completes the run AND exposes val ids/paths in this run's manifests", async (t) => {
  const f = await fixtureLoop(t);
  const out = await loopRun(f, { mode: "garbage", includeVal: true });
  assert.equal(out.exitCode, 0, out.lines.join("\n"));

  const rows = generations(f.repo);
  const incumbent = rows.find((d) => d.source === "incumbent");
  assert.equal(incumbent?.units.find((u) => u.unitId === "v1")?.scores.length, 2, "val benched with the flag too");

  const manifests = manifestsUnder(f.sandboxRoot);
  assert.ok(manifests.length >= 2);
  for (const m of manifests) {
    assert.ok(readFileSync(m, "utf8").includes(VAL_CANARY), `operator asked for exposure: ${m} still hides the val path`);
    const val = valEntry(m);
    assert.equal(val.id, "v1");
    assert.equal(val.path, VAL_PATH);
  }
});

// ------------------------------------------- pin (1b): candidate bench seam, no flag

test("regression: candidate bench (second seam) also carries val replicates without the flag", async (t) => {
  const f = await fixtureLoop(t);
  const out = await loopRun(f, { mode: "touch" });
  // the touch candidate is valid but score-identical ⇒ culled ⇒ run exit 1 (BLOCKED)
  assert.equal(out.exitCode, 1, out.lines.join("\n"));

  const candidate = generations(f.repo)
    .filter((d) => d.source === "candidate")
    .find((d) => d.candidateId === "touch-t1");
  assert.ok(candidate !== undefined, `candidate benched, lines: ${out.lines.join("\n")}`);
  assert.equal(candidate.complete, true);
  const byId = new Map(candidate.units.map((u) => [u.unitId, u]));
  assert.deepEqual(byId.get("v1")?.scores, [0.75, 0.75], "candidate bench carries val replicates for the gate");
  assert.equal(candidate.verdict, "culled");
  assert.ok(
    (candidate.gateFailures ?? []).some((msg) => /minEffect|gain/.test(msg)),
    `cull reason: ${String(candidate.gateFailures)}`,
  );
});
