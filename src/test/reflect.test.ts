// Todo 8 AC pins (plan lines 133-140): reflection brief builder + constrained-diff
// mutator session driver. Three layers:
//   1. buildBrief — pure text policy: train failures in, val aliases only, canary-out.
//   2. udiff + validateCandidate — pure parse/path policy: whole-candidate rejection,
//      traversal/artifact/immutable/syntax refusals, atomic in-memory apply.
//   3. runMutatorSession — integration over the toy genome in throwaway worktrees:
//      stub child emits 3 candidates (clean seal / kernel touch / fix-add), fitness
//      moves 0→1, rejections land in the ledger, malformed stdout is a clean error.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { ExitSignal } from "../exit.js";
import {
  ARTIFACT_GLOBS,
  artifactGlobsFromGitignore,
  buildBrief,
  runMutatorSession,
  validateCandidate,
  type BriefUnitEvidence,
  type MutatorSessionResult,
} from "../core/evolve/reflect.js";
import { applyChanges, parseUnifiedDiff } from "../core/evolve/udiff.js";
import { scriptedPatches } from "../core/evolve/stub-mutators.mjs";
import { Ledger, ledgerPath } from "../core/ledger.js";
import { fingerprint16 } from "../core/genome.js";
import { loadGenomeSpecFile, type GenomeSpec } from "../core/spec.js";
import { sealGeneration } from "../core/worktree.js";
import type { GenomeRef, WorktreeEnv } from "../core/genome-paths.js";
import { aggregateScore, type BudgetCounters, type UnitReplicates } from "../core/stats.js";
import { prepareToyGenome, ToyBenchAdapter } from "../bench/toy.js";
import { gitIn } from "./fixtures-wt.js";

// ------------------------------------------------------------------ fixtures

const COUNTERS: BudgetCounters = { candidates: 3, modelCalls: 7, tokens: 4242, wallS: 61.5 };

const CANARY = "VAL-TOPIC-CANARY-3f9c1a7e-organize-mess";

// byte-identical to genomes/toy-smoke/units/add.mjs (seeded bug on line 10)
const ADD_MJS = `// Toy unit: add — shipped WITH A SEEDED BUG (subtraction). The stub-mutators
// 'fix-add' scripted patch flips it to the correct sum; grader checks() grade it.
import path from "node:path";
import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function add(a, b) {
  return a - b; // seeded bug: must be \`return a + b;\`
}

export function checks() {
  return [add(2, 3) === 5, add(0, 7) === 7, add(-1, 1) === 0];
}

if (isMain) console.log(\`add(2,3)=\${add(2, 3)}\`);
`;

const FIX_ANCHOR = "return a - b; // seeded bug: must be `return a + b;`";

// The mutator child stub — mimics an opencode-or-script candidate generator: prints
// candidate JSON on stdout per --mode and copies every artifact it was GIVEN (argv,
// brief) and every byte it EMITS (candidates) into --capture, so the canary test can
// grep the entire mutator-facing surface. Written to a per-run tmp dir at test time.
const STUB_SOURCE = `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const mode = opt("--mode");
const dir = opt("--dir");
const brief = opt("--brief");
const capture = opt("--capture");
if (capture !== undefined) {
  mkdirSync(capture, { recursive: true });
  writeFileSync(capture + "/argv.json", JSON.stringify(process.argv) + "\\n");
  if (brief !== undefined) writeFileSync(capture + "/brief.md", readFileSync(brief, "utf8"));
}
const read = (f) => readFileSync(dir + "/" + f, "utf8");
function lineDiff(file, anchor, replacement) {
  const lines = read(file).split("\\n");
  const i = lines.findIndex((l) => l.includes(anchor));
  if (i < 0) { process.stderr.write("stub: no anchor in " + file + "\\n"); process.exit(1); }
  const changed = lines[i].replace(anchor, replacement);
  return "--- a/" + file + "\\n+++ b/" + file + "\\n@@ -" + String(i + 1) + ",1 +" + String(i + 1) + ",1 @@\\n-" + lines[i] + "\\n+" + changed + "\\n";
}
function createDiff(file, body) {
  const adds = body.split("\\n").map((l) => "+" + l).join("\\n");
  return "--- /dev/null\\n+++ b/" + file + "\\n@@ -0,0 +1," + String(body.split("\\n").length) + " @@\\n" + adds + "\\n";
}
const FIX = ${JSON.stringify(FIX_ANCHOR)};
const out = (candidates) => {
  const doc = JSON.stringify({ candidates });
  if (capture !== undefined) writeFileSync(capture + "/candidates.json", doc + "\\n");
  process.stdout.write(doc + "\\n");
};
if (mode === "three") {
  out([
    { id: "annotate-add", rationale: "annotate add()", diffs: [lineDiff("units/add.mjs", "export function add(", "export function add /* patched */(")] },
    { id: "touch-kernel", rationale: "subvert grading", diffs: [lineDiff("grader.mjs", "model-free", "model-free-ish")] },
    { id: "fix-add", rationale: "fix add(): subtraction to addition", diffs: [lineDiff("units/add.mjs", FIX, "return a + b;")] },
  ]);
} else if (mode === "artifact") {
  out([{ id: "artifact-evil", rationale: "plant build output", diffs: [createDiff("dist/evil.js", "console.log('pwned');")] }]);
} else if (mode === "garbage") {
  process.stdout.write("this is not json {{{\\n");
} else if (mode === "empty") {
  // deliberate: no output at all
} else if (mode === "array") {
  process.stdout.write('["diff", "strings"]\\n');
} else if (mode === "no-rationale") {
  out([{ id: "nameless", diffs: [lineDiff("units/add.mjs", FIX, "return a + b;")] }]);
} else {
  process.stderr.write("stub: unknown mode\\n");
  process.exit(2);
}
`;

function trainFail(): BriefUnitEvidence {
  return {
    unit: { id: "add", path: "units/add.mjs", split: "train" },
    scores: [0, 0],
    failures: ["assertion diff: expected add(2,3)===5, got -1"],
  };
}

function valEvidence(): BriefUnitEvidence {
  return {
    unit: { id: "sub", path: "units/sub.mjs", split: "val" },
    scores: [1, 1],
    failures: [CANARY], // even a failure note on val must never reach the brief
  };
}

// Only .label + .budget are read by buildBrief; full specs ride through unchanged.
const MIN_SPEC = {
  label: "budget-only",
  budget: { maxCandidates: 4, maxModelCalls: 16, maxTokens: 100000, maxWallS: 300 },
} as unknown as GenomeSpec;

interface Session {
  readonly spec: GenomeSpec;
  readonly env: WorktreeEnv;
  readonly root: string;
  readonly capture: string;
  readonly genome: GenomeRef;
  run(mutatorMode: string, brief?: string): Promise<MutatorSessionResult>;
}

async function sessionFixture(t: TestContext): Promise<Session> {
  const root = await mkdtemp(path.join(os.tmpdir(), "abathur-reflect-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stub = path.join(root, "mutator-stub.mjs");
  writeFileSync(stub, STUB_SOURCE, "utf8");
  const repo = await prepareToyGenome(path.join(root, "genome"));
  // plant the canary in the VAL unit and commit it, so it rides into worktrees
  const sub = path.join(repo, "units", "sub.mjs");
  writeFileSync(sub, `${readFileSync(sub, "utf8")}\n// ${CANARY}\n`, "utf8");
  await gitIn(repo, "-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "commit", "-aqm", "plant val canary");
  const spec = loadGenomeSpecFile(path.join(repo, "genome.jsonc"));
  const env: WorktreeEnv = {
    XDG_CACHE_HOME: path.join(root, "xdg-cache"),
    HOME: path.join(root, "fake-home"),
  };
  const capture = path.join(root, "capture");
  const genome: GenomeRef = { repoPath: repo, genomeFp: fingerprint16(spec) };
  return {
    spec,
    env,
    root,
    capture,
    genome,
    run(mutatorMode: string, brief: string = "(brief withheld in this session)") {
      const command =
        `node ${stub} --mode ${mutatorMode} --dir {worktree} --brief {brief} --capture ${capture}`;
      return runMutatorSession({ spec, brief, mutatorCommand: command, env });
    },
  };
}

function rejectedId(result: MutatorSessionResult, id: string) {
  const hits = result.rejected.filter((r) => r.candidateId === id);
  assert.equal(hits.length, 1, `expected exactly one rejection for ${id}`);
  const hit = hits[0];
  if (hit === undefined) assert.fail("unreachable");
  return hit;
}

function parseErrors(text: string): string {
  const r = parseUnifiedDiff(text);
  if (r.ok) assert.fail("expected parse rejection");
  return r.error;
}

function rejectionRecords(repo: string): readonly { candidateId: string; stage: string }[] {
  const lines = readFileSync(ledgerPath(repo), "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { kind: string; data: { candidateId?: string; stage?: string } });
  return lines
    .filter((l) => l.kind === "candidate_rejected")
    .map((l) => ({ candidateId: String(l.data.candidateId), stage: String(l.data.stage) }));
}

async function expectExit(code: 1 | 2, pattern: RegExp, action: Promise<unknown>): Promise<void> {
  try {
    await action;
  } catch (e: unknown) {
    assert.ok(e instanceof ExitSignal, `expected ExitSignal, got ${String(e)}`);
    assert.equal(e.code, code);
    assert.match(e.message, pattern);
    return;
  }
  assert.fail(`expected rejection with exit ${code}`);
}

/** Bench every train unit of `spec` over `reps` reps → aggregate (inconclusive excluded). */
async function trainAggregate(spec: GenomeSpec, sandboxRoot: string, reps: number): Promise<number> {
  const adapter = new ToyBenchAdapter(spec);
  const units: UnitReplicates[] = [];
  for (const unit of spec.bench.units.filter((u) => u.split === "train")) {
    const scores: number[] = [];
    for (let rep = 0; rep < reps; rep += 1) {
      const sandbox = path.join(sandboxRoot, `${unit.id}-${String(rep)}`);
      await adapter.reset(sandbox);
      await adapter.seed(sandbox);
      await adapter.run(unit, sandbox, spec.bench.timeoutS);
      const graded = await adapter.score(unit);
      if (graded.kind === "scored") scores.push(graded.result.score);
    }
    if (scores.length > 0) units.push({ unitId: unit.id, split: "train", scores });
  }
  return aggregateScore(units);
}

// ------------------------------------------------------------------ buildBrief

test("buildBrief: failed train units in, with assertion diffs + budget counters", () => {
  const passing: BriefUnitEvidence = { unit: { id: "mul", path: "units/mul.mjs", split: "train" }, scores: [1, 1], failures: [] };
  const brief = buildBrief(MIN_SPEC, [trainFail(), passing, valEvidence()], COUNTERS);
  assert.match(brief, /units\/add\.mjs/);
  assert.match(brief, /expected add\(2,3\)===5, got -1/);
  assert.match(brief, /candidates=3/);
  assert.match(brief, /tokens=4242/);
  assert.match(brief, /maxTokens=100000/);
  // passing train units are not failure material
  assert.doesNotMatch(brief, /units\/mul\.mjs/);
});

test("buildBrief: val units are OPAQUE aliases only — no id, path, score or content", () => {
  const val2: BriefUnitEvidence = { unit: { id: "organize-mess", path: "scenarios/04-organize-mess.md", split: "val" }, scores: [0], failures: [] };
  const brief = buildBrief(MIN_SPEC, [trainFail(), valEvidence(), val2], COUNTERS);
  assert.match(brief, /val-1/);
  assert.match(brief, /val-2/);
  assert.doesNotMatch(brief, /VAL-TOPIC-CANARY/);
  assert.doesNotMatch(brief, /units\/sub\.mjs/);
  assert.doesNotMatch(brief, /organize-mess/);
  assert.doesNotMatch(brief, /04-organize/);
});

test("buildBrief: pure + deterministic — same inputs byte-identical brief", () => {
  assert.equal(
    buildBrief(MIN_SPEC, [trainFail(), valEvidence()], COUNTERS),
    buildBrief(MIN_SPEC, [trainFail(), valEvidence()], COUNTERS),
  );
});

test("stub anchors stay byte-identical to the todo-5 scriptedPatches table", () => {
  const byId = new Map(scriptedPatches().map((p) => [p.id, p]));
  const fix = byId.get("fix-add");
  const anno = byId.get("annotate-add");
  if (fix === undefined || anno === undefined) assert.fail("table drifted");
  assert.ok(STUB_SOURCE.includes(JSON.stringify(fix.from)));
  assert.ok(STUB_SOURCE.includes(fix.to));
  assert.ok(STUB_SOURCE.includes(anno.from));
  assert.ok(STUB_SOURCE.includes(anno.to));
});

// ------------------------------------------------------------- udiff parse/apply

const FIX_ADD_DIFF =
  "--- a/units/add.mjs\n+++ b/units/add.mjs\n@@ -10,1 +10,1 @@\n-  return a - b; // seeded bug: must be `return a + b;`\n+  return a + b;\n";

test("udiff: parses modify hunk and applies it atomically in memory", () => {
  const parsed = parseUnifiedDiff(FIX_ADD_DIFF);
  if (!parsed.ok) assert.fail(parsed.error);
  const applied = applyChanges(parsed.changes, (rel) => (rel === "units/add.mjs" ? ADD_MJS : null));
  if (!applied.ok) assert.fail(applied.reason);
  assert.match(applied.files.get("units/add.mjs") ?? "", /return a \+ b;/);
  assert.deepEqual(applied.touched, ["units/add.mjs"]);
  assert.equal(/^[ ]{2}return a \+ b;$/m.test(ADD_MJS), false, "source sample must still carry the bug");
});

test("udiff: create-from-/dev/null allowed; delete, rename, binary refused as candidate ops", () => {
  assert.ok(parseUnifiedDiff("--- /dev/null\n+++ b/n/new.mjs\n@@ -0,0 +1,1 @@\n+hi\n").ok);
  assert.match(parseErrors("--- a/x.mjs\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-hi\n"), /delete/i);
  assert.match(parseErrors("diff --git a/x.mjs b/y.mjs\nsimilarity index 90%\nrename from x.mjs\nrename to y.mjs\n"), /rename/i);
  assert.match(parseErrors("--- a/x.bin\n+++ b/x.bin\nBinary files a/x.bin and b/x.bin differ\n"), /binary/i);
  assert.match(parseErrors("--- a/x.mjs\n+++ b/x.mjs\nGIT binary patch\nliteral 42\n"), /binary/i);
  assert.match(parseErrors("--- a/x.mjs\n+++ b/x.mjs\n@@ -1,1 +1,1 @@\n-\x00\x01\x7fELFgarbage\n+x\n"), /control characters/i);
});

test("udiff: hunk position or context mismatch (drifted worktree) → apply refuses, writes nothing", () => {
  const parsed = parseUnifiedDiff(FIX_ADD_DIFF);
  if (!parsed.ok) assert.fail(parsed.error);
  // one inserted line shifts the target from line 10 to line 11: positional apply refuses
  const applied = applyChanges(parsed.changes, (rel) => (rel === "units/add.mjs" ? `// drift notice\n${ADD_MJS}` : null));
  assert.equal(applied.ok, false);
  assert.match(applied.ok ? "" : applied.reason, /mismatch/i);
});

// ----------------------------------------------------------- validateCandidate

const POLICY = { immutableGlobs: ["grader.mjs"], artifactGlobs: ARTIFACT_GLOBS };

test("validateCandidate: clean candidate passes with parsed changes", () => {
  const v = validateCandidate({ id: "fix", rationale: "fix add()", diffs: [FIX_ADD_DIFF] }, POLICY);
  assert.ok(v.ok, v.ok ? "" : `${v.stage}: ${v.reason}`);
  assert.deepEqual(v.changes.map((c) => c.path), ["units/add.mjs"]);
});

test("validateCandidate: kernel-immutable AND artifact paths reject the WHOLE candidate", () => {
  const sealed = validateCandidate(
    { rationale: "sneak", diffs: ["--- a/grader.mjs\n+++ b/grader.mjs\n@@ -1,1 +1,1 @@\n-x\n+y\n", FIX_ADD_DIFF] },
    POLICY,
  );
  assert.equal(sealed.ok, false);
  assert.equal(sealed.ok ? "" : sealed.stage, "path");
  // mixed candidate: one artifact path poisons an otherwise-valid fix in the same candidate
  const mixed = validateCandidate(
    { rationale: "evil+good", diffs: ["--- /dev/null\n+++ b/dist/evil.js\n@@ -0,0 +1,1 @@\n+pwn\n", FIX_ADD_DIFF] },
    POLICY,
  );
  assert.equal(mixed.ok, false);
  assert.equal(mixed.ok ? "" : mixed.stage, "path");
  assert.match(mixed.ok ? "" : mixed.reason, /dist\/evil\.js/);
});

test("validateCandidate: traversal, .git, and hidden-state paths are refused by the path policy", () => {
  for (const bad of ["../../etc/passwd", "/etc/passwd", ".git/config", ".state/x.jsonc", "config.local.jsonc", "a/../../b/x.mjs"]) {
    const v = validateCandidate({ rationale: "r", diffs: [`--- /dev/null\n+++ b/${bad}\n@@ -0,0 +1,1 @@\n+x\n`] }, POLICY);
    assert.equal(v.ok, false, `must refuse ${bad}`);
  }
});

test("validateCandidate: schema stage — missing rationale, unknown field, empty diffs, non-object", () => {
  const missing = validateCandidate({ id: "x", diffs: [FIX_ADD_DIFF] }, POLICY);
  assert.equal(missing.ok, false);
  assert.equal(missing.ok ? "" : missing.stage, "schema");
  assert.equal(validateCandidate({ rationale: "r", diffs: [FIX_ADD_DIFF], hacker: true }, POLICY).ok, false);
  assert.equal(validateCandidate({ rationale: "r", diffs: [] }, POLICY).ok, false);
  assert.equal(validateCandidate("just a string", POLICY).ok, false);
  assert.equal(validateCandidate({ rationale: "", diffs: [FIX_ADD_DIFF] }, POLICY).ok, false);
});

test("validateCandidate: syntax stage — malformed diff body inside an otherwise fine candidate", () => {
  const v = validateCandidate({ rationale: "r", diffs: ["--- a/x\n+++ b/x\nnot a hunk at all\n"] }, POLICY);
  assert.equal(v.ok, false);
  assert.equal(v.ok ? "" : v.stage, "syntax");
});

test("artifactGlobsFromGitignore: directories, root-anchored, and negation skipping", () => {
  const globs = artifactGlobsFromGitignore("# c\n\nbuild/\n/only-root.txt\n*.tmp\n!keep.tmp\n");
  assert.ok(globs.includes("build/**"));
  assert.ok(globs.includes("**/build/**"));
  assert.ok(globs.includes("only-root.txt"));
  assert.equal(globs.some((g) => g.includes("keep")), false, "negations are skipped (fail-closed broadening)");
});

// --------------------------------------------------------- runMutatorSession AC

test("session AC: stub emits 3 candidates — clean seal, kernel-touch rejected+logged, fix-add applied", async (t) => {
  const fx = await sessionFixture(t);
  const brief = buildBrief(fx.spec, [trainFail(), valEvidence()], COUNTERS);
  const result = await fx.run("three", brief);

  assert.deepEqual(
    result.applied.map((a) => a.candidateId),
    ["annotate-add", "fix-add"],
  );
  const touch = rejectedId(result, "touch-kernel");
  assert.equal(touch.stage, "path");
  assert.match(touch.reason, /immutable/i);

  // rejections are booked in the genome ledger
  assert.deepEqual(rejectionRecords(fx.spec.repoPath), [{ candidateId: "touch-kernel", stage: "path" }]);
  assert.ok(Ledger.open(fx.spec.repoPath).readAll().some((r) => r.kind === "candidate_rejected"));

  // sealed generations are real worktrees with real commits
  for (const applied of result.applied) {
    assert.ok(applied.commitSha.length >= 7);
    assert.ok(existsSync(applied.worktreePath));
  }

  // fitness move: fix-add's sealed tree flips the train aggregate 0 → 1 on `add`
  const before = await trainAggregate(fx.spec, path.join(fx.root, "bench-before"), 2);
  const fix = result.applied.find((a) => a.candidateId === "fix-add");
  if (fix === undefined) assert.fail("fix-add must apply");
  const after = await trainAggregate({ ...fx.spec, repoPath: fix.worktreePath }, path.join(fx.root, "bench-after"), 2);
  console.log(`FITNESS MOVE train aggregate: ${String(before)} -> ${String(after)}`);
  assert.equal(before, 0.5); // add=0, mul=1 (explode inconclusive → excluded)
  assert.equal(after, 1); // add fixed to 1 by the sealed candidate
});

test("session AC: adversarial dist/evil.js candidate rejected at validation, logged, nothing applied", async (t) => {
  const fx = await sessionFixture(t);
  const result = await fx.run("artifact");
  assert.equal(result.applied.length, 0);
  const evil = rejectedId(result, "artifact-evil");
  assert.equal(evil.stage, "path");
  assert.match(evil.reason, /artifact/i);
  assert.deepEqual(rejectionRecords(fx.spec.repoPath), [{ candidateId: "artifact-evil", stage: "path" }]);
});

test("session canary: val scenario string absent from every mutator-facing artifact", async (t) => {
  const fx = await sessionFixture(t);
  const brief = buildBrief(fx.spec, [trainFail(), valEvidence()], COUNTERS);
  await fx.run("three", brief);

  // sanity: the canary IS in the genome (a real leak surface exists)
  assert.ok(readFileSync(path.join(fx.spec.repoPath, "units", "sub.mjs"), "utf8").includes(CANARY));

  // every file the capture dir holds = everything the child was given / emitted
  const files = readdirSync(fx.capture);
  assert.ok(files.includes("argv.json") && files.includes("brief.md"));
  for (const f of files) {
    const text = readFileSync(path.join(fx.capture, f), "utf8");
    assert.equal(text.includes(CANARY), false, `canary leaked into ${f}`);
    assert.equal(text.includes("units/sub.mjs"), false, `val path leaked into ${f}`);
  }
  assert.equal(brief.includes(CANARY), false);
});

test("session: missing mutator binary → clean exit 2 BEFORE spawn, nothing materialized", async (t) => {
  const fx = await sessionFixture(t);
  const command = `${path.join(fx.root, "no-such-mutator")} --dir {worktree} --brief {brief}`;
  await expectExit(2, /not found|not executable/i, runMutatorSession({ spec: fx.spec, brief: "b", mutatorCommand: command, env: fx.env }));
  // opencodeBin set to a dead path → same clean exit 2 for an 'opencode run …' template
  await expectExit(
    2,
    /opencode/i,
    runMutatorSession({
      spec: fx.spec,
      brief: "b",
      mutatorCommand: "opencode run --dir {worktree}",
      opencodeBin: path.join(fx.root, "definitely-missing-opencode"),
      env: fx.env,
    }),
  );
  assert.equal(existsSync(path.join(fx.root, "xdg-cache")), false, "nothing was materialized pre-spawn");
});

test("session: malformed stdout — non-JSON is a fatal clean error + ledger parse entry", async (t) => {
  const fx = await sessionFixture(t);
  await expectExit(1, /not JSON/i, fx.run("garbage"));
  assert.deepEqual(rejectionRecords(fx.spec.repoPath), [{ candidateId: "mutator-stdout", stage: "parse" }]);
});

test("session: malformed stdout — empty output and JSON array of strings are clean errors", async (t) => {
  const fx = await sessionFixture(t);
  await expectExit(1, /not JSON|no output/i, fx.run("empty"));
  await expectExit(1, /candidates/i, fx.run("array"));
  const stages = rejectionRecords(fx.spec.repoPath).map((r) => r.stage);
  assert.deepEqual(stages, ["parse", "schema"]);
});

test("session: per-candidate schema failure (missing rationale) rejects that candidate, session survives", async (t) => {
  const fx = await sessionFixture(t);
  const result = await fx.run("no-rationale");
  assert.equal(result.applied.length, 0);
  assert.equal(rejectedId(result, "nameless").stage, "schema");
  assert.deepEqual(rejectionRecords(fx.spec.repoPath), [{ candidateId: "nameless", stage: "schema" }]);
});

test("session stale_state: discarded worktrees are never sealable; same seed → same candidates", async (t) => {
  const fx = await sessionFixture(t);
  const first = await fx.run("three");
  await expectExit(
    1,
    /not found/i,
    sealGeneration(fx.genome, first.launchGenId, "abathur: stale seal probe", { env: fx.env }),
  );
  const second = await fx.run("three");
  assert.deepEqual(
    second.applied.map((a) => a.candidateId),
    first.applied.map((a) => a.candidateId),
  );
  assert.deepEqual(
    second.applied.map((a) => a.treeSha),
    first.applied.map((a) => a.treeSha),
  );
});
