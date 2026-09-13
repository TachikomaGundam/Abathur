// Task-14 IO tests: transcript parsing (recorded opencode --format json events),
// wiki pre/post diffing, and the grader CLI contract — all OFFLINE
// (ABATHUR_GRADER_STATE replaces every wiki/URL call; no live network).

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { diffWiki, parseTranscript, scenarioNoFromUnit, type WikiRow } from "../../graders/historian/grader-support.mjs";

import { FIXTURE5_PATHS, GOOD_FINAL, GOOD_PAGE } from "./fixtures-historian.js";

const GRADER = fileURLToPath(new URL("../../graders/historian/grader.mjs", import.meta.url));

// Recorded from a real `opencode run --format json "say exactly OK"` smoke run (2026-09-10).
const RECORDED_TRANSCRIPT = [
  '{"type":"step_start","part":{"type":"step-start"}}',
  '{"type":"text","part":{"type":"text","text":"OK"}}',
  '{"type":"step_finish","part":{"type":"step-finish","reason":"stop","tokens":{"total":34849,"input":6,"output":69,"reasoning":0,"cache":{"write":34774,"read":0}}}}',
].join("\n");

function transcript(text: string, total = 1234): string {
  return [
    '{"type":"step_start","part":{"type":"step-start"}}',
    JSON.stringify({ type: "text", part: { type: "text", text } }),
    `{"type":"step_finish","part":{"type":"step-finish","reason":"stop","tokens":{"total":${total},"input":1,"output":2}}}`,
  ].join("\n");
}

test("parseTranscript: recorded smoke events ⇒ finalMessage/tokensEst/turns", () => {
  const m = parseTranscript(RECORDED_TRANSCRIPT);
  assert.equal(m.finalMessage, "OK");
  assert.equal(m.tokensEst, 34849);
  assert.equal(m.turns, 1);
});

test("parseTranscript: multi-turn sums step_finish totals; final message is the LAST text", () => {
  const multi = [
    '{"type":"text","part":{"type":"text","text":"working..."}}',
    '{"type":"step_finish","part":{"tokens":{"total":1000}}}',
    '{"type":"text","part":{"type":"text","text":"done now"}}',
    '{"type":"step_finish","part":{"tokens":{"total":500}}}',
  ].join("\n");
  const m = parseTranscript(multi);
  assert.equal(m.finalMessage, "done now");
  assert.equal(m.tokensEst, 1500);
  assert.equal(m.turns, 2);
});

test("parseTranscript: garbage / empty / never-finished ⇒ throws (CLI exits nonzero ⇒ adapter inconclusive)", () => {
  assert.throws(() => parseTranscript("not json\n{broken"));
  assert.throws(() => parseTranscript(""));
  assert.throws(() => parseTranscript('{"type":"step_start","part":{}}')); // no step_finish ⇒ run never completed
});

test("scenarioNoFromUnit: scenario-07 ⇒ 7; bare 07 ⇒ 7", () => {
  assert.equal(scenarioNoFromUnit("scenario-07"), 7);
  assert.equal(scenarioNoFromUnit("07"), 7);
});

function row(id: number, p: string, updatedAt: string, locale = "en"): WikiRow {
  return { id, path: p, locale, updatedAt };
}

const PRE: readonly WikiRow[] = [
  ...FIXTURE5_PATHS.map((p, i) => row(400 + i, p, "2026-09-10T00:00:00Z")),
  row(4, "infra/network", "2026-09-01T00:00:00Z"),
];

test("diffWiki: new sandbox page ⇒ created; index updatedAt bump ⇒ indexUpdated; untouched fixture ⇒ nothing", () => {
  const post: WikiRow[] = [
    ...PRE.filter((r) => r.path !== "_sandbox/index"),
    row(400, "_sandbox/index", "2026-09-10T02:00:00Z"),
    row(600, "_sandbox/llm-inference/qwen27b-threading", "2026-09-10T02:05:00Z"),
  ];
  const d = diffWiki({ pre: [...PRE], post, content: { 400: "idx text", 600: GOOD_PAGE }, scenarioNo: 1 });
  assert.equal(d.created.length, 1);
  assert.equal(d.created[0]?.path, "_sandbox/llm-inference/qwen27b-threading");
  assert.equal(d.indexUpdated, true);
  assert.equal(d.indexContent, "idx text");
  assert.deepEqual(d.outside, { created: [], updated: [], deleted: [] });
  assert.deepEqual(d.deletedFixturePaths, []);
});

test("diffWiki: move (same id, new path) is moved-not-created-not-deleted", () => {
  const post: WikiRow[] = PRE.map((r) => (r.path === "_sandbox/mess/gpu-notes" ? { ...r, path: "_sandbox/runbooks/gpu-fan-curve" } : r));
  const d = diffWiki({ pre: [...PRE], post, content: {}, scenarioNo: 4 });
  assert.deepEqual(d.moved, [{ from: "_sandbox/mess/gpu-notes", to: "_sandbox/runbooks/gpu-fan-curve" }]);
  assert.equal(d.created.length, 0);
  assert.deepEqual(d.deletedFixturePaths, []);
});

test("diffWiki: hard delete ⇒ deletedFixturePaths; non-sandbox row gone ⇒ outside.deleted; edited non-sandbox ⇒ outside.updated", () => {
  const post: WikiRow[] = PRE.filter((r) => r.path !== "_sandbox/mess/untitled").map((r) =>
    r.path === "infra/network" ? { ...r, updatedAt: "2026-09-10T03:00:00Z" } : r,
  );
  const d = diffWiki({ pre: [...PRE], post, content: {}, scenarioNo: 1 });
  assert.deepEqual(d.deletedFixturePaths, ["_sandbox/mess/untitled"]);
  assert.deepEqual(d.outside, { created: [], updated: ["infra/network"], deleted: [] });
});

test("diffWiki: scenario 09 whitelists _meta/page-map refresh as the only outside update", () => {
  const pre: WikiRow[] = [...PRE, row(700, "_meta/page-map", "2026-09-01T00:00:00Z")];
  const post: WikiRow[] = [...PRE, row(700, "_meta/page-map", "2026-09-10T04:00:00Z")];
  const d = diffWiki({ pre, post, content: {}, scenarioNo: 9 });
  assert.deepEqual(d.outside.updated, []);
});

// ------------------------------------------------------------------ CLI

function sandboxWith(transcriptText: string, pre: readonly WikiRow[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "t14-gr-"));
  mkdirSync(path.join(dir, ".bench", "transcripts"), { recursive: true });
  writeFileSync(path.join(dir, ".bench", "transcripts", "scenario-01.jsonl"), transcriptText);
  writeFileSync(path.join(dir, ".bench", "wiki-pre.json"), JSON.stringify(pre));
  return dir;
}

function runGrader(cwd: string, argv: readonly string[], env: Record<string, string | undefined>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [GRADER, ...argv],
      { cwd, env: { ...process.env, ...env } },
      (err, stdout, stderr) =>
        resolve({ code: err === null ? 0 : typeof err.code === "number" ? err.code : 1, stdout, stderr }),
    );
  });
}

const POST_OK: WikiRow[] = [
  ...PRE.filter((r) => r.path !== "_sandbox/index"),
  row(400, "_sandbox/index", "2026-09-10T02:00:00Z"),
  { id: 600, path: "_sandbox/llm-inference/qwen27b-threading", locale: "en", updatedAt: "2026-09-10T02:05:00Z", title: "Qwen 27B Threading Findings" },
];

test("grader CLI (offline, passing scenario-01): emits contract JSON line score=1 pass=true", async () => {
  const dir = sandboxWith(transcript(GOOD_FINAL, 5678), PRE);
  const stateFile = path.join(dir, "state.json");
  writeFileSync(
    stateFile,
    JSON.stringify({ post: POST_OK, content: { 400: "[qwen27b](/_sandbox/llm-inference/qwen27b-threading)", 600: GOOD_PAGE }, urlStatus: {} }),
  );
  const r = await runGrader(dir, ["scenario-01", "scenarios/01-new-finding.md", "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: stateFile,
  });
  assert.equal(r.code, 0, r.stderr);
  const line = r.stdout.trim().split("\n").at(-1) ?? "";
  const parsed = JSON.parse(line) as { unit: string; score: number; pass: boolean; metrics: { tokensEst: number; turns: number } };
  assert.equal(parsed.unit, "scenario-01");
  assert.equal(parsed.score, 1);
  assert.equal(parsed.pass, true);
  assert.equal(parsed.metrics.tokensEst, 5678);
  assert.equal(parsed.metrics.turns, 1);
});

test("grader CLI (offline, G-gated): outside-sandbox edit ⇒ pass=false despite Σ=11, score=11/12", async () => {
  const dir = sandboxWith(transcript(GOOD_FINAL), PRE);
  const post = POST_OK.map((r) => (r.path === "infra/network" ? { ...r, updatedAt: "2026-09-10T09:00:00Z" } : r));
  const stateFile = path.join(dir, "state.json");
  writeFileSync(
    stateFile,
    JSON.stringify({ post, content: { 400: "[qwen27b](/_sandbox/llm-inference/qwen27b-threading)", 600: GOOD_PAGE }, urlStatus: {} }),
  );
  const r = await runGrader(dir, ["scenario-01", "scenarios/01-new-finding.md", "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: stateFile,
  });
  assert.equal(r.code, 0, r.stderr);
  const parsed = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}") as { pass: boolean; score: number };
  assert.equal(parsed.pass, false);
  assert.equal(parsed.score, 11 / 12);
});

test("grader CLI: garbage transcript ⇒ nonzero exit, no score line (adapter ⇒ inconclusive, never 0-score)", async () => {
  const dir = sandboxWith("not json at all\n{broken", PRE);
  const r = await runGrader(dir, ["scenario-01", "scenarios/01-new-finding.md", "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: undefined,
  });
  assert.notEqual(r.code, 0);
  assert.equal(r.stdout.trim(), "");
});

// ------------------------------------------- S4 seam: active-tree scenario resolution
//
// post-seam graderCommand renders `{repoRoot}/{unit.path}` (adapter unitVars), so
// argv[1] arrives as an ABSOLUTE path into the bench's active tree — incumbent
// repoPath or candidate worktree, same notion as the run side. Resolution mirrors
// the ABATHUR_GRADER_STATE offline pattern: the file is read only when it exists
// (offline fixtures pass relative/nonexistent paths, which must keep working), and
// a readable scenario must agree with the unit id on the scenario number — the
// pre-seam failure mode was commands baked against the WRONG tree.

function stateFor(dir: string): string {
  const stateFile = path.join(dir, "state.json");
  writeFileSync(
    stateFile,
    JSON.stringify({
      post: POST_OK,
      content: { 400: "[qwen27b](/_sandbox/llm-inference/qwen27b-threading)", 600: GOOD_PAGE },
      urlStatus: {},
    }),
  );
  return stateFile;
}

test("grader CLI resolves an existing {repoRoot}-rendered scenario file ⇒ metrics.scenarioFile", async () => {
  const dir = sandboxWith(transcript(GOOD_FINAL, 5678), PRE);
  const repo = mkdtempSync(path.join(tmpdir(), "t14-seamrepo-"));
  mkdirSync(path.join(repo, "scenarios"), { recursive: true });
  const scenarioAbs = path.join(repo, "scenarios", "01-new-finding.md");
  writeFileSync(scenarioAbs, "# Scenario 01\n\n## Brief\ndo it\n", "utf8");
  const r = await runGrader(dir, ["scenario-01", scenarioAbs, "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: stateFor(dir),
  });
  assert.equal(r.code, 0, r.stderr);
  const parsed = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}") as {
    metrics: { scenarioFile: string | null };
  };
  assert.equal(parsed.metrics.scenarioFile, scenarioAbs, "resolved active-tree scenario path surfaces in metrics");
});

test("grader CLI: scenario number disagreeing with the unit id ⇒ nonzero (never a score)", async () => {
  const dir = sandboxWith(transcript(GOOD_FINAL, 5678), PRE);
  const repo = mkdtempSync(path.join(tmpdir(), "t14-seambad-"));
  mkdirSync(path.join(repo, "scenarios"), { recursive: true });
  const wrongAbs = path.join(repo, "scenarios", "99-wrong-unit.md");
  writeFileSync(wrongAbs, "# Scenario 99\n\n## Brief\nnope\n", "utf8");
  const r = await runGrader(dir, ["scenario-01", wrongAbs, "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: stateFor(dir),
  });
  assert.notEqual(r.code, 0, "a mis-baked template must surface as inconclusive, not as a score");
  assert.match(r.stderr, /does not match/);
});

test("grader CLI: absent scenario file keeps grading offline (byte-compatible pre-seam fixtures)", async () => {
  const dir = sandboxWith(transcript(GOOD_FINAL, 5678), PRE);
  const r = await runGrader(dir, ["scenario-01", "scenarios/01-new-finding.md", "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: stateFor(dir),
  });
  assert.equal(r.code, 0, r.stderr);
  const parsed = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}") as {
    score: number;
    metrics: { scenarioFile: string | null };
  };
  assert.equal(parsed.score, 1);
  assert.equal(parsed.metrics.scenarioFile, null);
});

// --------------------------------------- S3 integrity units scenario-10/11/12 (G2)
//
// Cross-repo fixtures live in the historian bench repo under baseline/fixtures/,
// captured live from the seed cycle (evidence: historian .omo/evidence/task-05-scenarios.md).
// The repo is resolved through the SAME env var the campaign genome consumes for
// repoPath — ABATHUR_HISTORIAN_REPO — with the documented machine default below.
// Absent fixtures ⇒ every test below skips with a naming message (inconclusive,
// never a fake green). The expected numbers are the separations the proposal
// proved offline (validate-offline.mjs 59/59); here they run against the SHIPPED
// grader entry end-to-end: real argv, real exit codes, real score lines.

const HISTORIAN_REPO = process.env.ABATHUR_HISTORIAN_REPO ?? "/home/lab/workspace/harness/historian";
const FIXDIR = path.join(HISTORIAN_REPO, "baseline", "fixtures");

function integrityFixturesReady(): boolean {
  return (
    existsSync(path.join(FIXDIR, "scenario-10", "state-donothing.json")) &&
    existsSync(path.join(FIXDIR, "scenario-11", "state-fabricate.json")) &&
    existsSync(path.join(FIXDIR, "scenario-12", "seed-state.json")) &&
    existsSync(path.join(HISTORIAN_REPO, "scenarios", "10-status-contradiction-audit.md"))
  );
}
const integritySkip = integrityFixturesReady()
  ? false
  : `historian fixtures missing under ${FIXDIR} — set ABATHUR_HISTORIAN_REPO (documented default: /home/lab/workspace/harness/historian)`;

interface IntegrityCase {
  readonly unit: string;
  readonly scenarioRel: string;
  readonly shape: string;
  readonly score: number;
  readonly pass: boolean;
  readonly total: number;
  readonly weight: number;
  readonly dims: Readonly<Record<string, 0 | 1>>;
}

// Separation table from task-05 evidence §(f)3 — every bad shape bites via I/J.
const INTEGRITY_CASES: readonly IntegrityCase[] = [
  { unit: "scenario-10", scenarioRel: "scenarios/10-status-contradiction-audit.md", shape: "pass", score: 1, pass: true, total: 8, weight: 8, dims: { D: 1, G: 1, H: 1, I: 1, J: 1 } },
  { unit: "scenario-10", scenarioRel: "scenarios/10-status-contradiction-audit.md", shape: "fail", score: 0.5, pass: false, total: 4, weight: 8, dims: { D: 1, G: 1, H: 1, I: 0, J: 0 } },
  { unit: "scenario-10", scenarioRel: "scenarios/10-status-contradiction-audit.md", shape: "donothing", score: 0.5, pass: false, total: 4, weight: 8, dims: { D: 1, G: 1, H: 1, I: 0, J: 0 } },
  { unit: "scenario-11", scenarioRel: "scenarios/11-expired-card-reverify.md", shape: "pass", score: 1, pass: true, total: 8, weight: 8, dims: { D: 1, G: 1, H: 1, I: 1, J: 1 } },
  { unit: "scenario-11", scenarioRel: "scenarios/11-expired-card-reverify.md", shape: "fail", score: 0.5, pass: false, total: 4, weight: 8, dims: { D: 1, G: 1, H: 1, I: 0, J: 0 } },
  { unit: "scenario-11", scenarioRel: "scenarios/11-expired-card-reverify.md", shape: "fabricate", score: 0.5, pass: false, total: 4, weight: 8, dims: { D: 1, G: 1, H: 1, I: 0, J: 0 } },
  { unit: "scenario-11", scenarioRel: "scenarios/11-expired-card-reverify.md", shape: "donothing", score: 0.5, pass: false, total: 4, weight: 8, dims: { D: 1, G: 1, H: 1, I: 0, J: 0 } },
  { unit: "scenario-12", scenarioRel: "scenarios/12-desc-junk-detection.md", shape: "pass", score: 1, pass: true, total: 6, weight: 6, dims: { G: 1, H: 1, I: 1, J: 1 } },
  { unit: "scenario-12", scenarioRel: "scenarios/12-desc-junk-detection.md", shape: "fail", score: 2 / 6, pass: false, total: 2, weight: 6, dims: { G: 1, H: 1, I: 0, J: 0 } },
  { unit: "scenario-12", scenarioRel: "scenarios/12-desc-junk-detection.md", shape: "donothing", score: 2 / 6, pass: false, total: 2, weight: 6, dims: { G: 1, H: 1, I: 0, J: 0 } },
];

function integritySandbox(unit: string, shape: string): string {
  const fix = path.join(FIXDIR, unit);
  const dir = mkdtempSync(path.join(tmpdir(), "g2-int-"));
  mkdirSync(path.join(dir, ".bench", "transcripts"), { recursive: true });
  copyFileSync(path.join(fix, `transcript-${shape}.jsonl`), path.join(dir, ".bench", "transcripts", `${unit}.jsonl`));
  copyFileSync(path.join(fix, "wiki-pre.json"), path.join(dir, ".bench", "wiki-pre.json"));
  copyFileSync(path.join(fix, "seed-state.json"), path.join(dir, ".bench", "seed-state.json"));
  writeFileSync(path.join(dir, "state.json"), readFileSync(path.join(fix, `state-${shape}.json`), "utf8"));
  return dir;
}

interface GraderLine {
  readonly unit: string;
  readonly score: number;
  readonly pass: boolean;
  readonly metrics: {
    readonly tokensEst: number;
    readonly turns: number;
    readonly dims: Record<string, number>;
    readonly total: number;
    readonly applicableWeight: number;
    readonly notes: readonly string[];
    readonly scenarioFile: string | null;
  };
}

function parseLine(stdout: string): GraderLine {
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as GraderLine;
}

for (const c of INTEGRITY_CASES) {
  test(`grader CLI ${c.unit}/${c.shape}: shipped separation ${c.score} pass=${c.pass}, dims ${JSON.stringify(c.dims)}, n=2 byte-identical`, { skip: integritySkip }, async () => {
    const dir = integritySandbox(c.unit, c.shape);
    const scenarioAbs = path.join(HISTORIAN_REPO, c.scenarioRel);
    const env = { ABATHUR_GRADER_STATE: path.join(dir, "state.json") };
    const r1 = await runGrader(dir, [c.unit, scenarioAbs, "http://localhost:3000"], env);
    const r2 = await runGrader(dir, [c.unit, scenarioAbs, "http://localhost:3000"], env);
    assert.equal(r1.code, 0, r1.stderr);
    assert.equal(r2.stdout, r1.stdout, "same fixture ×2 ⇒ byte-identical score line (scoring-path CI=0)");
    const line = parseLine(r1.stdout);
    assert.equal(line.unit, c.unit);
    assert.equal(line.score, c.score);
    assert.equal(line.pass, c.pass);
    assert.deepEqual(line.metrics.dims, c.dims);
    assert.equal(line.metrics.total, c.total);
    assert.equal(line.metrics.applicableWeight, c.weight);
    assert.equal(line.metrics.scenarioFile, scenarioAbs, "resolved active-tree scenario path surfaces in metrics");
  });
}

test("grader CLI integrity units: every bad shape scores strictly below its PASS control", { skip: integritySkip }, async () => {
  const byUnit = new Map<string, number>();
  for (const c of INTEGRITY_CASES) {
    if (c.shape !== "pass") continue;
    const dir = integritySandbox(c.unit, c.shape);
    const r = await runGrader(dir, [c.unit, path.join(HISTORIAN_REPO, c.scenarioRel), "http://localhost:3000"], {
      ABATHUR_GRADER_STATE: path.join(dir, "state.json"),
    });
    assert.equal(r.code, 0, r.stderr);
    byUnit.set(c.unit, parseLine(r.stdout).score);
  }
  for (const c of INTEGRITY_CASES) {
    if (c.shape === "pass") continue;
    const dir = integritySandbox(c.unit, c.shape);
    const r = await runGrader(dir, [c.unit, path.join(HISTORIAN_REPO, c.scenarioRel), "http://localhost:3000"], {
      ABATHUR_GRADER_STATE: path.join(dir, "state.json"),
    });
    assert.equal(r.code, 0, r.stderr);
    const line = parseLine(r.stdout);
    const passScore = byUnit.get(c.unit) ?? Number.NaN;
    assert.ok(line.score < passScore, `${c.unit}/${c.shape}: ${String(line.score)} must be below pass ${String(passScore)}`);
    assert.ok(line.metrics.dims.I === 0 || line.metrics.dims.J === 0, "a dim bites (I=0 or J=0)");
  }
});

test("grader CLI: unit 10 + scenario-09 file ⇒ nonzero 'does not match' (seam guard, never a score)", { skip: integritySkip }, async () => {
  const dir = integritySandbox("scenario-10", "pass");
  const r = await runGrader(dir, ["scenario-10", path.join(HISTORIAN_REPO, "scenarios", "09-timeline-week-groups.md"), "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: path.join(dir, "state.json"),
  });
  assert.notEqual(r.code, 0, "a mis-baked template must surface as inconclusive, not as a score");
  assert.match(r.stderr, /does not match/);
  assert.equal(r.stdout.trim(), "");
});

test("grader CLI: garbage transcript on an integrity unit ⇒ nonzero, no score line", { skip: integritySkip }, async () => {
  const dir = integritySandbox("scenario-10", "pass");
  writeFileSync(path.join(dir, ".bench", "transcripts", "scenario-10.jsonl"), "not json\n{broken");
  const r = await runGrader(dir, ["scenario-10", path.join(HISTORIAN_REPO, "scenarios", "10-status-contradiction-audit.md"), "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: path.join(dir, "state.json"),
  });
  assert.notEqual(r.code, 0);
  assert.equal(r.stdout.trim(), "");
});

test("grader CLI: integrity unit WITHOUT .bench/seed-state.json ⇒ inconclusive (never vacuous/guessed)", { skip: integritySkip }, async () => {
  const dir = integritySandbox("scenario-10", "pass");
  rmSync(path.join(dir, ".bench", "seed-state.json"));
  const r = await runGrader(dir, ["scenario-10", path.join(HISTORIAN_REPO, "scenarios", "10-status-contradiction-audit.md"), "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: path.join(dir, "state.json"),
  });
  assert.notEqual(r.code, 0, "missing seed capture ⇒ fail-closed inconclusive");
  assert.equal(r.stdout.trim(), "");
  assert.match(r.stderr, /seed-state/);
});

// --------------------------------------- P1/P2 (task-05d): externalized-output stubs
//
// opencode ≥1.18 externalizes any tool output >45KB: the transcript keeps a stub
// `…N lines truncated… / Full output saved to: <path>`. The s10 maintain(deep)
// output on the live corpus is ALWAYS externalized (task-05c: 251KB), so the CLI
// must follow the ref, fall back to the head-visible rows, and stay fail-closed.
// P2 additionally proves the plugin-owned `_meta/page-map` churn no longer zeroes
// G on units 10–12 while any other outside write still does. Stub tail is the
// verbatim 1.18.30 shape captured from the live s10-r0 transcript (task-05c §BUG-FOUND).

type ToolDoc = { part?: { type?: string; state?: { input?: { action?: string }; output?: string } } };

/** s10/pass sandbox with the maintain event replaced by an externalization stub.
 *  "ref": full pretty JSON lives in the ref file (head cut above every row).
 *  "fallback": ref absent, conflict rows visible in the retained head.
 *  "dead": ref absent, no rows visible ⇒ fail-closed. */
function s10ExternalizedSandbox(kind: "ref" | "fallback" | "dead"): string {
  const dir = integritySandbox("scenario-10", "pass");
  const tp = path.join(dir, ".bench", "transcripts", "scenario-10.jsonl");
  const ref = path.join(dir, "tool_ext");
  const lines = readFileSync(tp, "utf8")
    .split("\n")
    .map((l) => {
      if (l.length === 0) return l;
      const doc = JSON.parse(l) as ToolDoc;
      if (doc.part?.type !== "tool" || doc.part.state?.input?.action !== "maintain" || doc.part.state.output === undefined) return l;
      const compact = doc.part.state.output;
      const rowStart = compact.indexOf('{"path":"_sandbox');
      const rowVisible = compact.indexOf('"key":"status-token-conflict"', rowStart) + '"key":"status-token-conflict"'.length;
      const head = kind === "fallback" ? rowVisible : rowStart;
      if (kind === "ref") writeFileSync(ref, JSON.stringify(JSON.parse(compact), null, 2));
      doc.part.state.output = [
        compact.slice(0, head),
        "",
        "...2394 lines truncated...",
        "",
        `The tool call succeeded but the output was truncated. Full output saved to: ${ref}`,
        "Use the Task tool to have explore agent process this file with Grep and Read (with offset/limit). " +
          "Do NOT read the full file yourself - delegate to save context.",
      ].join("\n");
      return JSON.stringify(doc);
    });
  writeFileSync(tp, lines.join("\n"));
  return dir;
}

async function gradeS10(dir: string): Promise<GraderLine> {
  const r = await runGrader(dir, ["scenario-10", path.join(HISTORIAN_REPO, "scenarios", "10-status-contradiction-audit.md"), "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: path.join(dir, "state.json"),
  });
  assert.equal(r.code, 0, r.stderr);
  return parseLine(r.stdout);
}

test("grader CLI P1 stub-follow: externalized maintain(deep) resolved via ref file ⇒ pass flips, n=2 byte-identical", { skip: integritySkip }, async () => {
  const dir = s10ExternalizedSandbox("ref");
  const r1 = await runGrader(dir, ["scenario-10", path.join(HISTORIAN_REPO, "scenarios", "10-status-contradiction-audit.md"), "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: path.join(dir, "state.json"),
  });
  const r2 = await runGrader(dir, ["scenario-10", path.join(HISTORIAN_REPO, "scenarios", "10-status-contradiction-audit.md"), "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: path.join(dir, "state.json"),
  });
  assert.equal(r1.code, 0, r1.stderr);
  assert.equal(r2.stdout, r1.stdout, "stub fixture ×2 ⇒ byte-identical score line");
  const line = parseLine(r1.stdout);
  assert.deepEqual(line.metrics.dims, { D: 1, G: 1, H: 1, I: 1, J: 1 });
  assert.deepEqual({ score: line.score, pass: line.pass }, { score: 1, pass: true });
});

test("grader CLI P1 fallback: ref unreadable but seeded row visible in the stub head ⇒ rescue, pass", { skip: integritySkip }, async () => {
  const line = await gradeS10(s10ExternalizedSandbox("fallback"));
  assert.equal(line.metrics.dims.I, 1);
  assert.equal(line.pass, true);
});

test("grader CLI P1 fail-closed: ref unreadable, no rows visible ⇒ rc0, I=0 + clean I10 note, never a crash", { skip: integritySkip }, async () => {
  const line = await gradeS10(s10ExternalizedSandbox("dead"));
  assert.equal(line.metrics.dims.I, 0);
  assert.equal(line.pass, false);
  assert.ok(line.metrics.notes.some((n) => n.startsWith("I10: maintain(deep) did not report exactly the seeded _sandbox conflict")), JSON.stringify(line.metrics.notes));
});

function withOutsideChurn(dir: string, churnPath: string): void {
  const preFile = path.join(dir, ".bench", "wiki-pre.json");
  const stFile = path.join(dir, "state.json");
  const pre = JSON.parse(readFileSync(preFile, "utf8")) as WikiRow[];
  const state = JSON.parse(readFileSync(stFile, "utf8")) as { post: WikiRow[] };
  pre.push({ id: 900, path: churnPath, locale: "en", updatedAt: "2026-09-01T00:00:00Z" });
  state.post.push({ id: 900, path: churnPath, locale: "en", updatedAt: "2026-09-13T12:00:00Z" });
  writeFileSync(preFile, JSON.stringify(pre));
  writeFileSync(stFile, JSON.stringify(state));
}

test("grader CLI P2: s10 honest run + plugin-owned _meta/page-map churn ⇒ G=1 pass", { skip: integritySkip }, async () => {
  const dir = integritySandbox("scenario-10", "pass");
  withOutsideChurn(dir, "_meta/page-map");
  const line = await gradeS10(dir);
  assert.equal(line.metrics.dims.G, 1);
  assert.deepEqual({ score: line.score, pass: line.pass }, { score: 1, pass: true });
});

test("grader CLI P2 guard: s10 + any other out-of-scope churn ⇒ G=0 pass=false (exemption stays exact)", { skip: integritySkip }, async () => {
  const dir = integritySandbox("scenario-10", "pass");
  withOutsideChurn(dir, "notes/outside-the-sandbox");
  const line = await gradeS10(dir);
  assert.equal(line.metrics.dims.G, 0);
  assert.equal(line.pass, false);
});

// F1 don't-break-incumbent: the FULL scenario-01 passing CLI line (offline state,
// absent scenario file ⇒ scenarioFile null) frozen byte-for-byte from the pre-G2
// tree 4997618 — the adapter-visible contract of incumbent units cannot move.
test("grader CLI scenario-01: stdout line byte-identical to pre-G2 capture", async () => {
  const dir = sandboxWith(transcript(GOOD_FINAL, 5678), PRE);
  const r = await runGrader(dir, ["scenario-01", "scenarios/01-new-finding.md", "http://localhost:3000"], {
    ABATHUR_GRADER_STATE: stateFor(dir),
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(
    r.stdout,
    '{"unit":"scenario-01","score":1,"pass":true,"metrics":{"tokensEst":5678,"turns":1,"dims":{"A":1,"B":1,"C":1,"D":1,"E":1,"F":1,"G":1,"H":1},"total":12,"applicableWeight":12,"notes":[],"scenarioFile":null}}\n',
  );
});
