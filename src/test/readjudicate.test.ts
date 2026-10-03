// re-adjudicate (core) tests. The mechanism under test: replay the CURRENT gate over
// archived generation rows and append a corrected verdict with provenance, files immutable.
//
// Coverage: verdict flip culled->nominated (synthetic), honest no-flip (culled stays
// culled), idempotence after append, promote-row refusal, missing-incumbent refusal,
// corrupt-archive notice (never a crash), and the historical anchor: a sandboxed COPY of
// the real historian archives must reproduce the c17 re-adjudication (NOMINATED,
// gain 0.2917) that the driver computed offline on 2026-09-26 — the engine's own replay
// of the incident that born this command.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readjudicateGeneration } from "../core/readjudicate.js";
import { ledgerRecordSchema, LEDGER_KIND_GENERATION_COMPLETE, LEDGER_KIND_PROMOTE } from "../core/ledger.js";
import { decodeGenerationRecord, type GenerationRowData } from "../core/evolve/run-rows.js";
import type { RegistryEntry } from "../core/genome.js";

const STATS = { halfWidth: 0.15, minEffect: 0.1, nReps: { initial: 2, max: 3 } };
const BUDGET = { maxCandidates: 1, maxModelCalls: 96, maxTokens: 25_000_000, maxWallS: 26_000 };

function entryFor(repo: string): RegistryEntry {
  return {
    fingerprint: "f".repeat(16),
    label: "test-genome",
    registryFile: "/dev/null",
    storedText: "",
    spec: {
      label: "test-genome",
      repoPath: repo,
      bench: {
        type: "opencode-fixture-scenarios",
        units: [
          { id: "scenario-19", split: "train", path: "scenarios/19.md" },
          { id: "scenario-13", split: "val", path: "scenarios/13.md" },
        ],
        runCommand: "true",
        graderCommand: "true",
        timeoutS: 1800,
        stats: STATS,
      },
      budget: BUDGET,
      kernel: { immutableGlobs: ["scenarios/**"] },
    } as RegistryEntry["spec"],
  };
}

interface RowOpts {
  readonly genId: string;
  readonly runId: string;
  readonly ts: string;
  readonly source: "candidate" | "incumbent";
  readonly units: { unitId: string; split: "train" | "val"; scores: number[] }[];
  readonly verdict?: GenerationRowData["verdict"];
  readonly gain?: number | null;
  readonly treeSha?: string;
}

function row(o: RowOpts): string {
  const data: Record<string, unknown> = {
    source: o.source,
    headCommit: "1".repeat(40),
    complete: true,
    reps: o.units[0]?.scores.length ?? 0,
    units: o.units.map((u) => ({ unitId: u.unitId, split: u.split, scores: u.scores, runIds: u.scores.map((_, i) => `r-${u.unitId}-${String(i)}`), failures: u.scores.filter((s) => s < 1).map((s) => `${u.unitId}: scored ${String(s)}`) })),
    counters: { candidates: o.source === "candidate" ? 1 : 0, modelCalls: 10, tokens: 1000, wallS: 100 },
    manifest: [],
    benchProvenance: { benchType: "opencode-fixture-scenarios", versions: [{ bin: "opencode", version: "test" }] },
  };
  if (o.source === "candidate") {
    data.candidateId = "mutate-live";
    data.commitSha = "2".repeat(40);
    data.treeSha = o.treeSha ?? "3".repeat(64);
  }
  if (o.verdict !== undefined) data.verdict = o.verdict;
  if (o.gain !== undefined) data.gain = o.gain;
  return `${JSON.stringify({ v: 1, ts: o.ts, kind: LEDGER_KIND_GENERATION_COMPLETE, genId: o.genId, runId: o.runId, data })}\n`;
}

function sandbox(t: { after: (fn: () => void) => void }): { dir: string; state: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "readjud-"));
  const state = path.join(dir, ".state", "abathur");
  mkdirSync(state, { recursive: true });
  writeFileSync(path.join(state, "ledger.jsonl"), "");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, state };
}

function cfg(t: { after: (fn: () => void) => void }): string {
  const d = mkdtempSync(path.join(tmpdir(), "readjud-cfg-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function lastRows(stateDir: string): GenerationRowData[] {
  return readFileSync(path.join(stateDir, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const parsed = ledgerRecordSchema.parse(JSON.parse(l));
      return parsed;
    })
    .filter((r) => r.kind === LEDGER_KIND_GENERATION_COMPLETE)
    .map((r) => {
      try {
        return decodeGenerationRecord(r);
      } catch {
        return null;
      }
    })
    .filter((d): d is GenerationRowData => d !== null);
}

test("flip: culled row re-judged nominated by the current gate; corrected row appended with provenance", (t) => {
  const { dir, state } = sandbox(t);
  // one rotated archive with the whole epoch (activation law: bank needs an archive)
  const lines = [
    // historical incumbent groups that price a small-ish sigma on both units
    row({ genId: "g-old-a", runId: "r-old", ts: "2026-09-20T00:00:00.000Z", source: "incumbent", units: [{ unitId: "scenario-19", split: "train", scores: [0.875, 1, 0.875, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1, 1, 1] }] }),
    // the epoch under re-adjudication
    row({ genId: "g-epoch", runId: "run-1", ts: "2026-09-21T00:00:00.000Z", source: "incumbent", units: [{ unitId: "scenario-19", split: "train", scores: [0.75, 0.875] }, { unitId: "scenario-13", split: "val", scores: [1, 1] }], verdict: undefined }),
    row({ genId: "g-epoch-cand", runId: "run-1", ts: "2026-09-21T01:00:00.000Z", source: "candidate", units: [{ unitId: "scenario-19", split: "train", scores: [1, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1] }], verdict: "culled", gain: 0.1 }),
  ];
  writeFileSync(path.join(state, "ledger.campaign1-2026-09-21.jsonl"), lines.join(""));
  const out = readjudicateGeneration({ entry: entryFor(dir), configDir: cfg(t), genId: "g-epoch-cand", now: () => new Date("2026-09-22T00:00:00Z") });
  assert.equal(out.appended, true, out.lines.join("\n"));
  assert.equal(out.verdict, "nominated", out.lines.join("\n"));
  const appended = lastRows(state).at(-1);
  assert.ok(appended !== undefined);
  assert.equal(appended.verdict, "nominated");
  assert.ok(appended.readjudication !== undefined, "provenance must be present");
  assert.equal(appended.readjudication.replacedVerdict, "culled");
  assert.equal(appended.readjudication.gate, "acceptance");
  assert.equal(appended.readjudication.sourceRows.candidate.file, "ledger.campaign1-2026-09-21.jsonl");
  // archive untouched: still exactly 3 rows, original culled row intact
  assert.equal(readFileSync(path.join(state, "ledger.campaign1-2026-09-21.jsonl"), "utf8").trim().split("\n").length, 3);
  // idempotence: second pass sees the corrected last row -> no-op
  const again = readjudicateGeneration({ entry: entryFor(dir), configDir: cfg(t), genId: "g-epoch-cand", now: () => new Date("2026-09-22T00:00:00Z") });
  assert.equal(again.appended, false, again.lines.join("\n"));
  assert.match(again.lines.join("\n"), /no-op/);
});

test("honest replay: a weak candidate stays culled — the tool re-judges, it never flips", (t) => {
  const { dir, state } = sandbox(t);
  const lines = [
    row({ genId: "g-old-a", runId: "r-old", ts: "2026-09-20T00:00:00.000Z", source: "incumbent", units: [{ unitId: "scenario-19", split: "train", scores: [1, 1, 1, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1, 1, 1] }] }),
    row({ genId: "g-epoch", runId: "run-1", ts: "2026-09-21T00:00:00.000Z", source: "incumbent", units: [{ unitId: "scenario-19", split: "train", scores: [1, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1] }] }),
    row({ genId: "g-epoch-cand", runId: "run-1", ts: "2026-09-21T01:00:00.000Z", source: "candidate", units: [{ unitId: "scenario-19", split: "train", scores: [1, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1] }], verdict: "culled", gain: 0 }),
  ];
  writeFileSync(path.join(state, "ledger.campaign1-2026-09-21.jsonl"), lines.join(""));
  const out = readjudicateGeneration({ entry: entryFor(dir), configDir: cfg(t), genId: "g-epoch-cand", now: () => new Date() });
  assert.equal(out.verdict, "culled", out.lines.join("\n"));
  assert.equal(out.appended, false, "already-agreeing row must not append");
});

test("refusals: promoted gen, missing incumbent, unknown gen — all block before any append", (t) => {
  const { dir, state } = sandbox(t);
  const epoch = [
    row({ genId: "g-epoch", runId: "run-9", ts: "2026-09-21T00:00:00.000Z", source: "incumbent", units: [{ unitId: "scenario-19", split: "train", scores: [0.75, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1] }] }),
    row({ genId: "g-epoch-cand", runId: "run-9", ts: "2026-09-21T01:00:00.000Z", source: "candidate", units: [{ unitId: "scenario-19", split: "train", scores: [1, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1] }], verdict: "culled", gain: 0.1 }),
  ];
  writeFileSync(path.join(state, "ledger.campaign1-2026-09-21.jsonl"), epoch.join(""));
  // promoted epoch is untouchable
  const promotedRun = "run-p";
  writeFileSync(path.join(state, "ledger.campaign2-2026-09-22.jsonl"),
    epoch.join("") + `${JSON.stringify({ v: 1, ts: "2026-09-22T00:00:00.000Z", kind: LEDGER_KIND_PROMOTE, genId: "g-epoch-cand", runId: promotedRun, data: { actor: "cli", genId: "g-epoch-cand", from: null, to: "2".repeat(40) } })}\n`);
  assert.throws(() => readjudicateGeneration({ entry: entryFor(dir), configDir: cfg(t), genId: "g-epoch-cand", now: () => new Date() }), (e: unknown) => /already promoted/.test(String((e as Error).message ?? e)));

  // unknown gen
  assert.throws(() => readjudicateGeneration({ entry: entryFor(dir), configDir: cfg(t), genId: "g-nope", now: () => new Date() }), (e: unknown) => /no candidate generation_complete row/.test(String((e as Error).message ?? e)));

  // candidate without its incumbent: run-1 incumbent exists here, so cut a state with candidate only
  const { dir: d2, state: s2 } = sandbox(t);
  writeFileSync(path.join(s2, "ledger.campaign1-2026-09-21.jsonl"),
    row({ genId: "g-solo", runId: "run-s", ts: "2026-09-21T01:00:00.000Z", source: "candidate", units: [{ unitId: "scenario-19", split: "train", scores: [1, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1] }], verdict: "culled", gain: 0.1 }));
  assert.throws(() => readjudicateGeneration({ entry: entryFor(d2), configDir: cfg(t), genId: "g-solo", now: () => new Date() }), (e: unknown) => /no incumbent baseline row/.test(String((e as Error).message ?? e)));
});

test("corrupt archive lines are notices, never a crash, and never poison the replay", (t) => {
  const { dir, state } = sandbox(t);
  const good = [
    row({ genId: "g-old-a", runId: "r-old", ts: "2026-09-20T00:00:00.000Z", source: "incumbent", units: [{ unitId: "scenario-19", split: "train", scores: [0.875, 1, 0.875, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1, 1, 1] }] }),
    row({ genId: "g-epoch", runId: "run-1", ts: "2026-09-21T00:00:00.000Z", source: "incumbent", units: [{ unitId: "scenario-19", split: "train", scores: [0.75, 0.875] }, { unitId: "scenario-13", split: "val", scores: [1, 1] }] }),
    row({ genId: "g-epoch-cand", runId: "run-1", ts: "2026-09-21T01:00:00.000Z", source: "candidate", units: [{ unitId: "scenario-19", split: "train", scores: [1, 1] }, { unitId: "scenario-13", split: "val", scores: [1, 1] }], verdict: "culled", gain: 0.1 }),
  ];
  writeFileSync(path.join(state, "ledger.campaign1-2026-09-21.jsonl"), `not json at all\n${good.join("")}{"v":9,"kind":"broken-schema"}\n`);
  const out = readjudicateGeneration({ entry: entryFor(dir), configDir: cfg(t), genId: "g-epoch-cand", now: () => new Date("2026-09-22T00:00:00Z") });
  assert.equal(out.verdict, "nominated", out.lines.join("\n"));
  assert.ok(out.lines.some((l) => l.includes("not JSON")), "skip notice must surface");
});

// ------------------------------------------------------------------ historical anchor
// The incident replay: c17's real rows, judged first by the silently-downgraded engine
// (culled), then re-adjudicated offline to NOMINATED gain 0.2917 (start-work L141).
// A sandboxed copy of the real archives run through this command must reproduce that
// verdict with the same numbers — the engine re-judging its own history correctly.
// Skips (never fails) when the historian state files are absent (CI elsewhere).
test("anchor: real c17 archives replay to NOMINATED 0.2917 (copy, no mutation)", (t) => {
  // located via env, never a hardcoded homedir (release hygiene); skipped wherever the
  // historian repo is not wired — this anchor guards the OPERATOR's machine, CI has no history.
  const hist = process.env["ABATHUR_HISTORIAN_REPO"];
  if (hist === undefined || hist.length === 0) {
    t.skip("ABATHUR_HISTORIAN_REPO unset — anchor needs the real archives");
    return;
  }
  const real = path.join(hist, ".state", "abathur");
  let names: string[];
  try {
    names = readdirSync(real);
  } catch {
    t.skip("historian .state/abathur not present on this machine");
    return;
  }
  const archives = names.filter((n) => n.startsWith("ledger.") && n.endsWith(".jsonl"));
  if (!archives.some((n) => n.includes("campaign17"))) {
    t.skip("campaign17 archive not present");
    return;
  }
  const { dir, state } = sandbox(t);
  for (const n of archives) copyFileSync(path.join(real, n), path.join(state, n));
  writeFileSync(path.join(state, "ledger.jsonl"), ""); // copy of live would carry future rows — start empty
  // spec: mirror the historian constitution's anchors exactly (stats/budget as registered)
  const spec = entryFor(dir);
  (spec.spec.bench as { stats: unknown }).stats = STATS;
  const out = readjudicateGeneration({ entry: spec, configDir: cfg(t), genId: "g-20260925T150918Z-9969e4b6", now: () => new Date("2026-09-28T00:00:00Z") });
  assert.equal(out.verdict, "nominated", out.lines.join("\n"));
  const appended = lastRows(state).at(-1);
  assert.ok(appended?.readjudication !== undefined);
  assert.ok(Math.abs((appended.gain ?? 0) - 0.2916666666666667) < 1e-9, `gain ${String(appended.gain)} must match the offline replay 0.2917`);
  assert.equal(appended.readjudication.replacedVerdict, "culled");
  assert.equal(appended.readjudication.sourceRows.candidate.file, "ledger.campaign17-2026-09-25.jsonl");
});
