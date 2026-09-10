// Task-14 IO tests: transcript parsing (recorded opencode --format json events),
// wiki pre/post diffing, and the grader CLI contract — all OFFLINE
// (ABATHUR_GRADER_STATE replaces every wiki/URL call; no live network).

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
