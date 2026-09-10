// Todo 11 friction digest + self-genome plumbing pins.
//   AC-1: a forced rejection-storm toy run appends >= 1 STRUCTURED friction
//     record to the queue file (<configDir>/friction.jsonl via the todo-2
//     guarded helpers), with byStage counts matching the observed rejects;
//   AC-2: a unique canary planted in the val unit's id/path NEVER appears in the
//     queue file (val runs contribute counts/aliases only);
//   schema: strings echo-sanitized + bounded; malformed pre-existing queue ⇒
//     fail-closed readable error, never a crash;
//   CLI errors after registry resolution land as cause 'cli-error' records
//     (spawned `run` on a drifted kernel — refuses exit 1, record written);
//   machine-independence: the abathur-self seed registers under different
//     ABATHUR_SELF_REPO values to the IDENTICAL fingerprint/stored bytes, and an
//     unset env exits 2 naming the variable;
//   structural: no todo-11 module may reference promote authority, and none may
//     (dynamically) load candidate code into the harness process.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import test from "node:test";

import { ExitSignal } from "../exit.js";
import { registerGenome, requireGenomesByLabel, fingerprint16, type RegistryEntry } from "../core/genome.js";
import { appendFriction, frictionQueuePath } from "../core/ledger.js";
import { loadGenomeSpecFile } from "../core/spec.js";
import { effectiveRepoPath, isEnvRepoLiteral } from "../core/spec.js";
import { prepareToyGenome } from "../bench/toy.js";
import { runEvolution } from "../core/evolve/run-loop.js";
import type { WorktreeEnv } from "../core/genome-paths.js";
import {
  FRICTION_KIND,
  appendRunFriction,
  buildRunFriction,
  readFrictionDigests,
  frictionDigestSchema,
  type RunFrictionInput,
} from "../core/evolve/friction.js";

const HARNESS_ROOT = path.resolve(new URL("../../", import.meta.url).pathname);

function baseInput(over: Partial<RunFrictionInput> = {}): RunFrictionInput {
  return {
    genomeFp: "0123456789abcdef",
    cause: "run-summary",
    exit: 1,
    complete: true,
    counts: { applied: 1, rejected: 3, benched: 2, inconclusive: 0, nominated: 0, timeouts: 0, reaped: 0 },
    rejected: [
      { stage: "path", reason: "immutable path grader.mjs" },
      { stage: "schema", reason: "missing diffs" },
      { stage: "apply", reason: "hunk context mismatch" },
    ],
    units: [
      { unitId: "add", split: "train", scores: [0, 1], failures: ["add rep 0: scored 0 (not passing)"] },
      { unitId: "sub", split: "val", scores: [1, 1], failures: [] },
    ],
    reasons: ["gate: aggregate gain 0.5000 < minEffect 0.6000"],
    stall: { budgetTruncated: false, orphanGroups: 0 },
    ...over,
  };
}

test("friction: buildRunFriction sanitizes and bounds every string, fail-closed schema", () => {
  const nasty = `ESCAPE\u001b[31mRED\nline2 \u0000 tab\t end ${"x".repeat(5000)}`;
  const input = baseInput({
    rejected: [{ stage: "unknown\u001bstage", reason: nasty }],
    reasons: [nasty, nasty, nasty, nasty, nasty, nasty, nasty, nasty, nasty, nasty],
    units: [
      { unitId: "unit".repeat(80), split: "train", scores: [1], failures: [nasty, nasty, nasty, nasty, nasty, nasty] },
      ...baseInput().units,
    ],
  });
  const record = buildRunFriction(input);
  assert.equal(record.kind, FRICTION_KIND);
  const data = frictionDigestSchema.parse(record.data);
  const text = JSON.stringify(data);
  assert.ok(!text.includes("\u001b"));
  assert.ok(!text.includes("\n"));
  for (const reason of data.reasons) {
    assert.ok(reason.length <= 200);
    assert.match(reason, /^[\x20-\x7e]*$/);
  }
  assert.ok(data.reasons.length <= 10, "reasons are hard-capped at 10");
  assert.equal(data.rejections.total, 1);
  assert.equal(data.rejections.byStage.path, 0);
  const unit = data.train[0];
  assert.ok(unit !== undefined && unit.unitId.length <= 120 && unit.failures.length <= 4);
  // val material never textual: the sub unit contributes alias + counts only.
  assert.deepEqual(data.val, { count: 1, aliases: ["val-1"], samples: 2 });
  assert.ok(!JSON.stringify(data.val).includes("sub"));
  // fail-closed on a broken record: negative count never reaches the builder output.
  assert.throws(() => buildRunFriction(baseInput({ counts: { ...baseInput().counts, applied: -1 } })));
});

function tmpConfig(t: TestContextLike): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "abathur-friction-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  return configDir;
}

interface TestContextLike {
  after(fn: () => void): void;
}

test("friction: append/read round-trip through the guarded queue file", (t) => {
  const configDir = tmpConfig(t);
  const first = appendRunFriction(configDir, baseInput());
  appendRunFriction(configDir, baseInput({ cause: "cli-error", exit: 2, reasons: ["abathur: nope"] }));
  assert.equal(first.kind, FRICTION_KIND);
  const { digests, error } = readFrictionDigests(configDir);
  assert.equal(error, null);
  assert.equal(digests.length, 2);
  assert.deepEqual(digests.map((d) => d.cause), ["run-summary", "cli-error"]);
  const raw = readFileSync(frictionQueuePath(configDir), "utf8");
  assert.equal(raw.endsWith("\n"), true);
});

test("friction: malformed queue line fails closed with a readable error, never crashes", (t) => {
  const configDir = tmpConfig(t);
  appendRunFriction(configDir, baseInput());
  const file = frictionQueuePath(configDir);
  const good = readFileSync(file, "utf8");
  writeFileSync(file, `${good}{{{ not json at all\n${good}`, "utf8");
  const mid = readFrictionDigests(configDir);
  assert.equal(mid.digests.length, 0);
  assert.ok(mid.error !== null && mid.error.includes("line 2"));
  // a crash-truncated TAIL (no trailing newline) is repaired like the ledger's own:
  const configDir2 = tmpConfig(t);
  appendRunFriction(configDir2, baseInput());
  const f2 = frictionQueuePath(configDir2);
  writeFileSync(f2, `${readFileSync(f2, "utf8")}${good.trimEnd().slice(0, 40)}`, "utf8");
  const repaired = readFrictionDigests(configDir2);
  assert.equal(repaired.error, null);
  assert.equal(repaired.digests.length, 1);
});

test("friction: foreign schema-valid record kinds in the queue fail closed (never crash)", (t) => {
  const configDir = tmpConfig(t);
  appendFriction(configDir, { kind: "generation_complete", data: { anything: true } });
  const { digests, error } = readFrictionDigests(configDir);
  assert.equal(digests.length, 0);
  assert.ok(error !== null && error.includes("friction_digest"));
});

// ------------------------------------------------------------- toy run storms

export const STUB_STORM = `#!/usr/bin/env node
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
const mulFirst = read("units/mul.mjs").split("\\n")[0];
process.stdout.write(JSON.stringify({ candidates: [
  { id: "touch-kernel", rationale: "subvert grading", diffs: [lineDiff("grader.mjs", "model-free", "model-free-ish")] },
  { id: "no-diffs", rationale: "schema damage" },
  { id: "wrong-context", rationale: "apply damage", diffs: ["--- a/units/add.mjs\\n+++ b/units/add.mjs\\n@@ -1,1 +1,1 @@\\n-" + mulFirst + "\\n+" + mulFirst + " /*x*/\\n"] },
  { id: "annotate-add", rationale: "harmless annotate", diffs: [lineDiff("units/add.mjs", "export function add(", "export function add /* patched */(")] },
] }) + "\\n");
`;

interface StormFixture {
  readonly root: string;
  readonly configDir: string;
  readonly repo: string;
  readonly entry: RegistryEntry;
  readonly mutatorCommand: string;
  readonly env: WorktreeEnv;
  readonly queue: string;
}

async function stormFixture(t: TestContextLike, canaryVal = false): Promise<StormFixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "abathur-storm-"));
  t.after(() => spawnSyncRm(root));
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const repo = await prepareToyGenome(path.join(root, "genome"));
  if (canaryVal) {
    // rename the val unit BEFORE registration (edit-then-register rule); the file
    // is a bench target, so the rename must be committed or openGenome refuses.
    const specPath = path.join(repo, "genome.jsonc");
    const doc = JSON.parse(readFileSync(specPath, "utf8")) as {
      bench: { units: { id: string; path: string; split: string }[] };
    };
    const val = doc.bench.units.find((u) => u.split === "val");
    if (val === undefined) throw new Error("fixture: toy-smoke lost its val unit");
    const subBytes = readFileSync(path.join(repo, val.path), "utf8");
    val.id = "val-CANARY-9f3a";
    val.path = "units/CANARY-9f3a-sub.mjs";
    writeFileSync(specPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    rmSync(path.join(repo, "units/sub.mjs"));
    writeFileSync(path.join(repo, val.path), subBytes, "utf8");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-m", "canary val unit");
  }
  registerGenome(configDir, path.join(repo, "genome.jsonc"));
  const entry = requireGenomesByLabel(configDir, "toy-smoke").entries[0];
  if (entry === undefined) throw new Error("fixture: toy-smoke vanished from registry");
  const stub = path.join(root, "stub.mjs");
  writeFileSync(stub, STUB_STORM, "utf8");
  chmodSync(stub, 0o755);
  return {
    root,
    configDir,
    repo,
    entry,
    mutatorCommand: `node ${stub} --dir {worktree} --brief {brief}`,
    env: { XDG_CACHE_HOME: path.join(root, "xdg"), HOME: path.join(root, "home") },
    queue: frictionQueuePath(configDir),
  };
}

function spawnSyncRm(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

test("AC-1: rejection-storm toy run appends one structured friction digest matching observed rejects", async (t) => {
  // stage rename: the canary file write needs the ORIGINAL sub.mjs bytes first.
  const f = await stormFixture(t);
  const seen: RunFrictionInput[] = [];
  const outcome = await runEvolution({
    entry: f.entry,
    configDir: f.configDir,
    mutatorCommand: f.mutatorCommand,
    env: f.env,
    sandboxRoot: path.join(f.root, "sandboxes"),
    friction: (input) => {
      seen.push(input);
      appendRunFriction(f.configDir, input);
    },
  });
  assert.equal(seen.length, 1, "exactly one run-summary digest per run");
  assert.equal(outcome.exitCode, 1, "no nomination in the storm => blocked exit");
  const { digests, error } = readFrictionDigests(f.configDir);
  assert.equal(error, null);
  assert.equal(digests.length, 1);
  const d = digests[0];
  if (d === undefined) throw new Error("unreachable");
  assert.equal(d.cause, "run-summary");
  assert.equal(d.genomeFp, f.entry.fingerprint);
  assert.equal(d.rejections.total, 3);
  assert.deepEqual(d.rejections.byStage, { schema: 1, syntax: 0, path: 1, apply: 1, parse: 0 });
  assert.equal(d.counts.applied, 1);
  assert.equal(d.counts.rejected, 3);
  assert.equal(d.counts.benched, 2);
  assert.equal(d.counts.nominated, 0);
  assert.equal(d.exit, 1);
  assert.equal(d.complete, true);
  assert.ok(d.train.some((u) => u.unitId === "add" && u.n === 4), "train unit ids preserved (incumbent+candidate samples merged per unit)");
  // misleading_success guard: every rejection line the run printed is counted.
  const rejectedLines = outcome.lines.filter((l) => l.includes("rejected ("));
  assert.equal(rejectedLines.length, d.rejections.total);
});

test("AC-2: canary planted in the val unit NEVER appears in the friction queue", async (t) => {
  const f = await stormFixture(t, true);
  const outcome = await runEvolution({
    entry: f.entry,
    configDir: f.configDir,
    mutatorCommand: f.mutatorCommand,
    env: f.env,
    sandboxRoot: path.join(f.root, "sandboxes"),
    friction: (input) => appendRunFriction(f.configDir, input),
  });
  assert.equal(outcome.exitCode, 1);
  const raw = readFileSync(f.queue, "utf8");
  assert.ok(raw.length > 0, "the queue file was written");
  assert.ok(!raw.includes("CANARY"), "val canary (id AND path) never reaches the queue");
  assert.ok(!raw.includes("sub"), "even the original val id is absent");
  const { digests, error } = readFrictionDigests(f.configDir);
  assert.equal(error, null);
  const val = digests[0]?.val;
  assert.deepEqual(val, { count: 1, aliases: ["val-1"], samples: 4 }, "scrubbed val material is present as counts/aliases");
});

function gitIn(repo: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "-C", repo, ...args], { stdio: "pipe" });
}

test("friction: run CLI on drifted kernel records cause cli-error (spawned exit 1)", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "abathur-drift-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.jsonc");
  writeFileSync(configPath, '{ "opencodeBin": null }\n', "utf8");
  const repo = mkdtempSync(path.join(root, "genome"));
  // register a minimal fake toy genome: coverage needs files only.
  touchSeal(repo, ["units/add.mjs", "units/mul.mjs", "units/explode.mjs", "units/sub.mjs", "grader.mjs"]);
  writeFileSync(path.join(repo, "genome.jsonc"), toySpec(repo), "utf8");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  execFileSync("git", ["-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "-C", repo, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "-C", repo, "commit", "-m", "genome"], { stdio: "pipe" });
  registerGenome(configDir, path.join(repo, "genome.jsonc"));
  // drift the sealed grader AFTER registration:
  writeFileSync(path.join(repo, "grader.mjs"), "// tampered\n", "utf8");
  const run = spawnSync(process.execPath, [path.join(HARNESS_ROOT, "dist/cli.js"), "run", "--genome", "toy-drift"], {
    encoding: "utf8",
    env: { ...process.env, ABATHUR_CONFIG: configPath, HOME: path.join(root, "home"), XDG_CACHE_HOME: path.join(root, "xdg") },
  });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /kernel drift/);
  const { digests, error } = readFrictionDigests(configDir);
  assert.equal(error, null);
  assert.equal(digests.length, 1);
  const d = digests[0];
  assert.ok(d !== undefined && d.cause === "cli-error" && d.exit === 1);
  assert.ok(d.reasons.some((r) => r.includes("kernel drift")));
  // the refusal wrote no ledger state (audit precedes Ledger.open):
  assert.equal(existsSync(path.join(repo, ".state")), false);
});

function touchSeal(root: string, rels: string[]): void {
  for (const rel of rels) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, "// unit\nexport function checks() { return [true]; }\n", "utf8");
  }
}

function toySpec(repo: string): string {
  return `{
  "label": "toy-drift",
  "repoPath": ${JSON.stringify(repo)},
  "bench": {
    "type": "toy",
    "units": [
      { "id": "add", "path": "units/add.mjs", "split": "train" },
      { "id": "sub", "path": "units/sub.mjs", "split": "val" }
    ],
    "runCommand": "node {unit.path}",
    "graderCommand": "node grader.mjs {unit.path}",
    "timeoutS": 10,
    "stats": { "halfWidth": 0.25, "minEffect": 0.5, "nReps": { "initial": 2, "max": 4 } }
  },
  "budget": { "maxCandidates": 4, "maxModelCalls": 16, "maxTokens": 100000, "maxWallS": 300 },
  "kernel": { "immutableGlobs": ["grader.mjs"] }
}
`;
}

// ------------------------------------------------- machine-independence (seed)

function liteSelfRepo(root: string): void {
  touchSeal(root, [
    "src/core/stats.ts",
    "src/core/ledger.ts",
    "src/core/ids.ts",
    "src/core/genome.ts",
    "src/core/promote.ts",
    "src/bench/toy.ts",
    "src/bench/fixture.ts",
    "graders/contract.json",
    "genomes/abathur-self.jsonc",
    "scripts/copy-assets.mjs",
    "package.json",
    "tsconfig.json",
  ]);
}

test("seed genome: fingerprint + registry stem machine-independent across ABATHUR_SELF_REPO values", (t) => {
  const spec = loadGenomeSpecFile(path.join(HARNESS_ROOT, "genomes/abathur-self.jsonc"));
  assert.equal(spec.label, "abathur-self");
  assert.equal(spec.repoPath, "${ABATHUR_SELF_REPO}");
  assert.equal(isEnvRepoLiteral(spec.repoPath), true);
  assert.equal(effectiveRepoPath("relative/repo").length > 0, true);
  const fp = fingerprint16(spec);
  assert.match(fp, /^[0-9a-f]{16}$/);

  const homes: { dir: string; env: string }[] = [];
  for (const name of ["A", "B"]) {
    const root = mkdtempSync(path.join(os.tmpdir(), `abathur-selfreg-${name}-`));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const configDir = path.join(root, "config");
    mkdirSync(configDir, { recursive: true });
    const repoDir = path.join(root, "harness");
    liteSelfRepo(repoDir);
    homes.push({ dir: configDir, env: repoDir });
  }
  const [homeA, homeB] = homes as [{ dir: string; env: string }, { dir: string; env: string }];
  const saved = process.env.ABATHUR_SELF_REPO;
  try {
    process.env.ABATHUR_SELF_REPO = homeA.env;
    registerGenome(homeA.dir, path.join(HARNESS_ROOT, "genomes/abathur-self.jsonc"));
    process.env.ABATHUR_SELF_REPO = homeB.env;
    registerGenome(homeB.dir, path.join(HARNESS_ROOT, "genomes/abathur-self.jsonc"));
  } finally {
    if (saved === undefined) delete process.env.ABATHUR_SELF_REPO;
    else process.env.ABATHUR_SELF_REPO = saved;
  }
  const fileA = path.join(homeA.dir, "genomes", `${fp}.jsonc`);
  const fileB = path.join(homeB.dir, "genomes", `${fp}.jsonc`);
  assert.ok(existsSync(fileA) && existsSync(fileB), "same registry stem under both env values");
  const a = readFileSync(fileA, "utf8");
  assert.equal(a, readFileSync(fileB, "utf8"));
  assert.ok(a.includes("${ABATHUR_SELF_REPO}"), "stored spec keeps the LITERAL, never the resolved path");

  // unset env => every consumer exits 2 naming the variable, never a literal dir:
  delete process.env.ABATHUR_SELF_REPO;
  const root3 = mkdtempSync(path.join(os.tmpdir(), "abathur-selfreg-C-"));
  t.after(() => rmSync(root3, { recursive: true, force: true }));
  try {
    registerGenome(root3, path.join(HARNESS_ROOT, "genomes/abathur-self.jsonc"));
    assert.fail("registration must refuse without ABATHUR_SELF_REPO");
  } catch (error) {
    assert.ok(error instanceof ExitSignal && error.code === 2);
    assert.match(error.message, /ABATHUR_SELF_REPO/);
  }
  assert.equal(existsSync(path.join(root3, "${ABATHUR_SELF_REPO}")), false);
});

// ----------------------------------------------------------- structural guard

test("structural: todo-11 modules grant no promote authority and load no candidate code", () => {
  const files = [
    "src/core/evolve/friction.ts",
    "src/core/evolve/self-snapshot.ts",
    "src/core/evolve/self-overlay.ts",
    "src/commands/self-eval.ts",
  ];
  for (const rel of files) {
    const text = readFileSync(path.join(HARNESS_ROOT, rel), "utf8");
    for (const banned of ["core/promote.js", "promoteGeneration", "fastForwardIncumbent", "new Function", "eval(", " child_process.exec(", "execSync("]) {
      assert.ok(!text.includes(banned), `${rel} must not reference '${banned}'`);
    }
    assert.ok(!/import\s*\(/.test(text), `${rel} must not dynamically import candidate code`);
  }
});
