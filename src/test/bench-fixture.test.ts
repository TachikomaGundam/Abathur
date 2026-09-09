// Todo 6 acceptance pins for the opencode-fixture-scenarios adapter. The whole
// bench runs against FAKE opencodeBins (bash fixtures written to tmp by these
// tests): argv-spawned shebang scripts, never a shell string. Pins:
//  (A) 2-unit matrix runs end to end (provenance, metrics, transcript, HOME env);
//  (B) val scenario paths never appear in the mutator-readable manifest, and a
//      val run without includeVal is exit 2 (operator flag gates it);
//  (C) --version missing/garbage/minVersion mismatch ⇒ exit 2 BEFORE any unit;
//  (D) requires[] probes: missing cmd / probeExit mismatch ⇒ exit 2 naming it;
//  (E) hanging unit ⇒ process-group kill at timeoutS, zero orphans (pgrep-level);
//  (F) infra_failed is recorded distinctly, never looks like a score;
//  (G) garbage grader / garbage run stdout ⇒ inconclusive / zeroed metrics, no crash;
//  (H) crash → reset → seed digest == clean start (stale-state proof);
//  (I) single-flight lock: second concurrent adapter gets exit 2 "another bench active";
//  (J) sandbox HOME: ONLY .opencode/{plugin,skills,node_modules} + copied-then-mutated
//      config, never symlinks, real HOME untouched.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { ExitSignal } from "../exit.js";
import { treeDigestAt } from "../core/ids.js";
import { parseGenomeSpecDocument, type BenchUnit, type GenomeSpec } from "../core/spec.js";
import type { RunResult, ScoreOutcome } from "../bench/adapter.js";
import { FixtureScenariosAdapter, type FixtureAdapterOptions } from "../bench/fixture.js";
import { compareSemver, parseSemver, sandboxHomeDir } from "../bench/fixture.js";

// ------------------------------------------------------------------- helpers

function keep(t: TestContext, dir: string): string {
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function freshDir(t: TestContext, prefix: string): Promise<string> {
  return keep(t, await mkdtemp(path.join(os.tmpdir(), `abathur-${prefix}-`)));
}

async function writeScript(dir: string, name: string, body: string): Promise<string> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, body, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

function isExit2(cause: unknown): boolean {
  return cause instanceof ExitSignal && cause.code === 2;
}

// Fake opencode bins. Contract consumed by the adapter: `--version` prints a
// semver line; `run <unit.path>` executes the scenario (writes $ABATHUR_TRANSCRIPT,
// echoes a final JSON metrics line). Hang/no-version/garbage variants probe the
// adversarial classes.

const BIN_GOOD = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--version" ]; then echo "1.2.3"; exit 0; fi
unit="\${2:-}"
case "$unit" in
  *poison*) echo dirty > poison.txt ;;
esac
if [ -n "\${ABATHUR_TRANSCRIPT:-}" ]; then
  mkdir -p "$(dirname "$ABATHUR_TRANSCRIPT")"
  printf 'transcript %s model=%s judge=%s home=%s\\n' \\
    "$unit" "\${ABATHUR_AGENT_MODEL:-none}" "\${ABATHUR_JUDGE_MODEL:-none}" "$HOME" \\
    > "$ABATHUR_TRANSCRIPT"
fi
echo "ran $unit"
echo '{"tokensEst":123,"turns":4}'
`;

const BIN_HANG = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "1.2.3"; exit 0; fi
exec sleep 31.7
`;

const BIN_NO_VERSION = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "unsupported flag" >&2; exit 1; fi
echo "ran \${2:-}"
`;

const BIN_GARBAGE_VERSION = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "banana split deluxe"; exit 0; fi
echo "ran \${2:-}"
`;

const BIN_GARBAGE_RUN = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "1.2.3"; exit 0; fi
echo 'garbage {{{ not json at all'
`;

/** Genome repo: opaque scenario files + reset/seed scripts + sandbox grader. */
async function fixtureGenome(t: TestContext): Promise<string> {
  const genDir = path.join(await freshDir(t, "fixgen"), "germ");
  await mkdir(genDir, { recursive: true });
  await writeFile(path.join(genDir, "scenarios-one.md"), "alpha train scenario\n", "utf8");
  await writeFile(path.join(genDir, "scenarios-two.md"), "beta train scenario\n", "utf8");
  await writeFile(
    path.join(genDir, "scenarios-poison.md"),
    "gamma state-mutating train scenario\n",
    "utf8",
  );
  await writeFile(
    path.join(genDir, "scenarios-val-canary-ZZHIDDEN.md"),
    "holdout val scenario ZZHIDDEN\n",
    "utf8",
  );
  await writeScript(
    genDir,
    "reset.sh",
    `#!/usr/bin/env bash
set -euo pipefail
rm -rf "\${1:?sandbox}"
mkdir -p "\${1:?sandbox}"
`,
  );
  await writeScript(
    genDir,
    "seed.sh",
    `#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
sandbox="\${1:?sandbox}"
mkdir -p "$sandbox/scenarios"
cp "$here"/scenarios-*.md "$sandbox/scenarios/"
cp "$here"/grader.mjs "$sandbox/grader.mjs"
touch "$sandbox/seeded.flag"
`,
  );
  await writeFile(
    path.join(genDir, "grader.mjs"),
    `const [unitId] = process.argv.slice(2);
const table = {
  one: { score: 1, pass: true },
  two: { score: 0.5, pass: false },
  poison: { score: 0, pass: false },
  val: { score: 0.25, pass: false },
};
const row = table[unitId];
if (!row) { console.error("unknown unit " + unitId); process.exit(1); }
console.log(JSON.stringify({ unit: unitId, score: row.score, pass: row.pass, metrics: { tokensEst: 42, turns: 2 } }));
`,
    "utf8",
  );
  return genDir;
}

const TRAIN_UNITS: readonly { id: string; path: string; split: "train" }[] = [
  { id: "one", path: "scenarios/scenarios-one.md", split: "train" },
  { id: "two", path: "scenarios/scenarios-two.md", split: "train" },
];
const VAL_UNIT = {
  id: "val",
  path: "scenarios/scenarios-val-canary-ZZHIDDEN.md",
  split: "val",
} as const;
const POISON_UNIT = {
  id: "poison",
  path: "scenarios/scenarios-poison.md",
  split: "train",
} as const;

interface SpecOverrides {
  readonly runCommand?: string;
  readonly minVersion?: string;
  readonly requires?: readonly { cmd: string; args?: readonly string[]; probeExit: number }[];
  readonly timeoutS?: number;
}

function fixtureSpec(genDir: string, binPath: string, over: SpecOverrides = {}): GenomeSpec {
  return parseGenomeSpecDocument(
    {
      label: "fixture-germ",
      repoPath: genDir,
      bench: {
        type: "opencode-fixture-scenarios",
        units: [...TRAIN_UNITS, VAL_UNIT],
        runCommand: over.runCommand ?? `${binPath} run {unit.path}`,
        seedCommand: `${genDir}/seed.sh {sandbox}`,
        resetCommand: `${genDir}/reset.sh {sandbox}`,
        graderCommand: "node grader.mjs {unit.id}",
        judgeCommand: "node judge.mjs {unit.id}",
        judgeModel: "test/judge",
        agentModel: "test/agent",
        timeoutS: over.timeoutS ?? 5,
        stats: { halfWidth: 0.1, minEffect: 0.05, nReps: { initial: 1, max: 2 } },
      },
      budget: { maxCandidates: 2, maxModelCalls: 10, maxTokens: 1000, maxWallS: 60 },
      kernel: { immutableGlobs: [] },
      requires: over.requires ?? [{ cmd: "node", args: ["--version"], probeExit: 0 }],
      opencodeBinVersion: { minVersion: over.minVersion ?? "1.0.0" },
    },
    "<test>",
  );
}

/** Home with the mirrored subset, decoys that must never be copied, and a config. */
async function fakeHome(t: TestContext): Promise<string> {
  const home = await freshDir(t, "fixhome");
  for (const rel of [
    ".opencode/plugin/x.js",
    ".opencode/skills/s.md",
    ".opencode/node_modules/m/package.json",
    ".opencode/secrets.txt",
    ".bashrc",
    ".config/opencode/opencode.json",
    ".config/opencode/prompts/p.md",
  ]) {
    const p = path.join(home, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, rel === ".config/opencode/opencode.json" ? '{"theme":"dark"}\n' : `${rel}\n`, "utf8");
  }
  return home;
}

interface AdapterFixture {
  readonly adapter: FixtureScenariosAdapter;
  readonly spec: GenomeSpec;
  readonly sandbox: string;
  readonly home: string;
  readonly configDir: string;
}

async function adapterFixture(
  t: TestContext,
  body: string = BIN_GOOD,
  over: SpecOverrides = {},
  opts: FixtureAdapterOptions = {},
): Promise<AdapterFixture> {
  const binDir = await freshDir(t, "fixbin");
  const binPath = await writeScript(binDir, "oc-fake", body);
  const genDir = await fixtureGenome(t);
  const home = await fakeHome(t);
  const configDir = path.join(home, ".config", "abathur");
  const spec = fixtureSpec(genDir, binPath, over);
  const sandbox = path.join(await freshDir(t, "fixsbx"), "sb");
  const adapter = new FixtureScenariosAdapter(spec, {
    env: { HOME: home },
    home,
    configDir,
    opencodeBin: binPath,
    ...opts,
  });
  return { adapter, spec, sandbox, home, configDir };
}

function manifestPath(sandbox: string): string {
  return path.join(sandbox, ".bench", "manifest.json");
}

function scored(outcome: ScoreOutcome): { score: number; pass: boolean } {
  if (outcome.kind === "scored") return outcome.result;
  assert.fail(`expected scored, got inconclusive: ${outcome.reason}`);
}

// ------------------------------------------------------------------ AC (A)

test("(A) 2-unit run: statuses, provenance versions, metrics, transcript, HOME env", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, {}, { includeVal: true });
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);

  const rows: { run: RunResult; score: ScoreOutcome }[] = [];
  for (const unit of [TRAIN_UNITS[0]!, VAL_UNIT] as BenchUnit[]) {
    rows.push({
      run: await f.adapter.run(unit, f.sandbox, f.spec.bench.timeoutS),
      score: await f.adapter.score(unit),
    });
  }
  for (const { run } of rows) {
    assert.equal(run.status, "ok");
    assert.equal(run.exitCode, 0);
    assert.equal(run.benchProvenance.benchType, "opencode-fixture-scenarios");
    const versions = new Map(run.benchProvenance.versions.map((v) => [v.bin, v.version]));
    assert.equal(versions.get("node"), process.version);
  }
  const [a, b] = rows as [{ run: RunResult; score: ScoreOutcome }, { run: RunResult; score: ScoreOutcome }];
  assert.equal(scored(a.score).score, 1);
  assert.equal(scored(b.score).score, 0.25);
  assert.equal(scored(b.score).pass, false);
  assert.equal(a.run.metrics.tokensEst, 123); // parsed from the fake bin's run metadata
  assert.equal(a.run.metrics.turns, 4);

  const sbHome = sandboxHomeDir(f.sandbox);
  const transcript = readFileSync(a.run.transcriptPath ?? "", "utf8");
  assert.match(transcript, /model=test\/agent/);
  assert.match(transcript, /judge=test\/judge/);
  assert.ok(transcript.includes(`home=${sbHome}`), `transcript home must be the sandbox HOME: ${transcript}`);

  // the observed opencode version string is present in EVERY RunResult provenance
  for (const { run } of rows) {
    assert.ok(
      run.benchProvenance.versions.some((v) => v.version === "1.2.3" && v.bin.includes("oc-fake")),
      "observed fake-bin version missing from provenance",
    );
  }
  // seed copied the scenario files
  assert.ok(existsSync(path.join(f.sandbox, "seeded.flag")));
});

// ------------------------------------------------------------------ AC (B)

test("(B) val paths hidden from the mutator manifest; val run needs includeVal", async (t) => {
  const f = await adapterFixture(t);
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);

  const raw = readFileSync(manifestPath(f.sandbox), "utf8");
  assert.ok(!raw.includes("ZZHIDDEN"), "canary scenario filename leaked into manifest");
  assert.ok(!raw.includes("val-canary"), "val path leaked into manifest");
  assert.ok(raw.includes("scenarios/scenarios-one.md"), "train path must stay visible");

  const entries = JSON.parse(raw)["scenarios"] as { alias: string; split: string; id?: string; path?: string }[];
  const valEntry = entries.find((e) => e.split === "val");
  assert.ok(valEntry !== undefined, "manifest must still count the val scenario");
  assert.equal(valEntry.id, undefined);
  assert.equal(valEntry.path, undefined);
  assert.match(valEntry.alias, /^scenario-\d{2}$/);

  // default adapter: running the val unit is a tool error naming the operator flag
  await assert.rejects(
    () => f.adapter.run(VAL_UNIT as BenchUnit, f.sandbox, f.spec.bench.timeoutS),
    (cause: unknown) => isExit2(cause) && /--include-val/.test((cause as ExitSignal).message),
  );

  // operator-flagged adapter may run it end to end
  const op = await adapterFixture(t, BIN_GOOD, {}, { includeVal: true });
  await op.adapter.reset(op.sandbox);
  await op.adapter.seed(op.sandbox);
  const run = await op.adapter.run(VAL_UNIT as BenchUnit, op.sandbox, op.spec.bench.timeoutS);
  assert.equal(run.status, "ok");
  assert.ok(readFileSync(manifestPath(op.sandbox), "utf8").includes("ZZHIDDEN")); // operator sees the truth
});

// ------------------------------------------------------------------ AC (C)

test("(C1) --version unsupported ⇒ exit 2 before ANY unit executed", async (t) => {
  const f = await adapterFixture(t, BIN_NO_VERSION);
  await assert.rejects(() => f.adapter.reset(f.sandbox), isExit2);
  assert.ok(!existsSync(manifestPath(f.sandbox)), "manifest must never be written pre-probe");
  const marker = spawnSync("pgrep", ["-f", "oc-fake run"], { encoding: "utf8" });
  assert.equal((marker.stdout ?? "").trim(), "", "a unit ran despite the failed probe");
});

test("(C2) garbage --version output ⇒ exit 2, message names the parse failure", async (t) => {
  const f = await adapterFixture(t, BIN_GARBAGE_VERSION);
  await assert.rejects(
    () => f.adapter.reset(f.sandbox),
    (cause: unknown) => isExit2(cause) && /banana/.test((cause as ExitSignal).message),
  );
});

test("(C3) minVersion mismatch ⇒ exit 2 quoting observed and required", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, { minVersion: "9.9.9" });
  await assert.rejects(
    () => f.adapter.reset(f.sandbox),
    (cause: unknown) =>
      isExit2(cause) && /1\.2\.3/.test((cause as ExitSignal).message) && /9\.9\.9/.test((cause as ExitSignal).message),
  );
});

// ------------------------------------------------------------------ AC (D)

test("(D1) missing requires[] binary ⇒ exit 2 naming the prerequisite", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, {
    requires: [{ cmd: "abathur-no-such-engine", probeExit: 0 }],
  });
  await assert.rejects(
    () => f.adapter.reset(f.sandbox),
    (cause: unknown) =>
      isExit2(cause) && /abathur-no-such-engine/.test((cause as ExitSignal).message),
  );
});

test("(D2) requires probeExit mismatch ⇒ exit 2", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, {
    requires: [{ cmd: "node", args: ["--version"], probeExit: 3 }],
  });
  await assert.rejects(() => f.adapter.reset(f.sandbox), isExit2);
});

// ------------------------------------------------------------------ AC (E)

test("(E) hanging unit: group kill at timeoutS, zero orphans", async (t) => {
  const f = await adapterFixture(t, BIN_HANG, { timeoutS: 1 });
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  const started = Date.now();
  const run = await f.adapter.run(TRAIN_UNITS[0] as BenchUnit, f.sandbox, 1);
  assert.ok(Date.now() - started < 8000);
  assert.equal(run.status, "timeout");
  assert.equal(run.exitCode, null);
  assert.match(run.note ?? "", /killed after 1s: process group SIGKILL/);
  const ps = spawnSync("ps", ["-eo", "args"], { encoding: "utf8" });
  assert.ok(!ps.stdout.includes("sleep 31.7"), "orphaned sleep survived the group kill");
});

// ------------------------------------------------------------------ AC (F)

test("(F) infra_failed is recorded with a distinct status/note, never a silent 0", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, {
    runCommand: "abathur-no-such-bin run {unit.path}",
  });
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  const run = await f.adapter.run(TRAIN_UNITS[0] as BenchUnit, f.sandbox, 5);
  assert.equal(run.status, "infra_failed");
  assert.equal(run.exitCode, null);
  assert.match(run.note ?? "", /spawn failed/);
});

// ------------------------------------------------------------------ AC (G)

test("(G1) garbage run stdout ⇒ ok with zeroed metrics, no parse crash", async (t) => {
  const f = await adapterFixture(t, BIN_GARBAGE_RUN);
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  const run = await f.adapter.run(TRAIN_UNITS[0] as BenchUnit, f.sandbox, 5);
  assert.equal(run.status, "ok");
  assert.deepEqual(run.metrics, { tokensEst: 0, turns: 0 });
});

test("(G2) failing / garbage grader ⇒ inconclusive-for-unit, never a crash", async (t) => {
  const f = await adapterFixture(t);
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);

  const unknown = await f.adapter.score({ id: "ghost", path: "scenarios/none.md", split: "train" });
  assert.equal(unknown.kind, "inconclusive");
  if (unknown.kind === "inconclusive") assert.match(unknown.reason, /unknown unit ghost/);

  await writeFile(path.join(f.sandbox, "grader.mjs"), 'process.stdout.write("not json at all\\n");\n', "utf8");
  const bad = await f.adapter.score(TRAIN_UNITS[0] as BenchUnit);
  assert.equal(bad.kind, "inconclusive");
  if (bad.kind === "inconclusive") assert.match(bad.reason, /not a score JSON line/);
});

// ------------------------------------------------------------------ AC (H)

test("(H) crash→reset→seed restores the exact clean-start digest", async (t) => {
  const f = await adapterFixture(t);
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  const clean = treeDigestAt(f.sandbox);

  const run = await f.adapter.run(POISON_UNIT as BenchUnit, f.sandbox, 5);
  assert.equal(run.status, "ok");
  assert.ok(existsSync(path.join(f.sandbox, "poison.txt")), "poison scenario must dirty the sandbox");
  assert.notEqual(treeDigestAt(f.sandbox), clean);

  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  assert.ok(!existsSync(path.join(f.sandbox, "poison.txt")));
  assert.equal(treeDigestAt(f.sandbox), clean);
});

// ------------------------------------------------------------------ AC (I)

test("(I) single-flight: second adapter exit 2 'another bench active', ok after release", async (t) => {
  const binDir = await freshDir(t, "fixbin");
  const binPath = await writeScript(binDir, "oc-fake", BIN_GOOD);
  const genDir = await fixtureGenome(t);
  const home = await fakeHome(t);
  const configDir = path.join(home, ".config", "abathur");
  const spec = fixtureSpec(genDir, binPath);
  const a = new FixtureScenariosAdapter(spec, { env: { HOME: home }, home, configDir, opencodeBin: binPath });
  const b = new FixtureScenariosAdapter(spec, { env: { HOME: home }, home, configDir, opencodeBin: binPath });
  const sandboxA = path.join(await freshDir(t, "fixsbx"), "sb-a");
  await a.reset(sandboxA); // holds the fingerprint-keyed lease
  const sandboxB = path.join(await freshDir(t, "fixsbx"), "sb-b");
  await assert.rejects(
    () => b.reset(sandboxB),
    (cause: unknown) => isExit2(cause) && /another bench active/.test((cause as ExitSignal).message),
  );
  a.release();
  await b.reset(sandboxB); // lease free again
  b.release();
});

// ------------------------------------------------------------------ AC (J)

test("(J) sandbox HOME copies only the .opencode subset + mutated config copy; real HOME untouched", async (t) => {
  const f = await adapterFixture(t);
  const openDigest = treeDigestAt(path.join(f.home, ".opencode"));
  const cfgDigest = treeDigestAt(path.join(f.home, ".config", "opencode"));
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);

  const sbHome = sandboxHomeDir(f.sandbox);
  assert.ok(existsSync(path.join(sbHome, ".opencode", "plugin", "x.js")));
  assert.ok(existsSync(path.join(sbHome, ".opencode", "skills", "s.md")));
  assert.ok(existsSync(path.join(sbHome, ".opencode", "node_modules", "m", "package.json")));
  assert.ok(!existsSync(path.join(sbHome, ".opencode", "secrets.txt")), "secrets must not be mirrored");
  assert.ok(!existsSync(path.join(sbHome, ".bashrc")), "dotfiles outside the subset must not be mirrored");

  const cfg = path.join(sbHome, ".config", "opencode", "opencode.json");
  assert.ok(lstatSync(cfg).isFile(), "opencode config must be a copied regular file, never a symlink");
  const doc = JSON.parse(readFileSync(cfg, "utf8")) as Record<string, unknown>;
  assert.equal(doc["model"], "test/agent"); // mutated per scenario
  assert.equal(doc["theme"], "dark"); // copied content preserved
  assert.ok(existsSync(path.join(sbHome, ".config", "opencode", "prompts", "p.md")));
  assert.equal(treeDigestAt(path.join(f.home, ".opencode")), openDigest, "real .opencode must be untouched");
  assert.equal(treeDigestAt(path.join(f.home, ".config", "opencode")), cfgDigest, "real opencode config must be untouched");
  const realCfg = JSON.parse(readFileSync(path.join(f.home, ".config", "opencode", "opencode.json"), "utf8")) as Record<string, unknown>;
  assert.equal(realCfg["model"], undefined);
});

// -------------------------------------------------------------- semver edges

test("semver helpers: 1.10 > 1.9, prerelease < release, garbage ⇒ null", () => {
  const cmp = (a: string, b: string): number => {
    const va = parseSemver(a);
    const vb = parseSemver(b);
    if (va === null || vb === null) throw new Error(`unparsable: ${a} / ${b}`);
    return compareSemver(va, vb);
  };
  assert.ok(cmp("1.10.0", "1.9.0") > 0);
  assert.equal(cmp("1.2.3", "1.2.3"), 0);
  assert.ok(cmp("1.2.3-beta", "1.2.3") < 0);
  assert.ok(cmp("v2.0.0", "1.99.99") > 0);
  assert.equal(parseSemver("banana"), null);
});
