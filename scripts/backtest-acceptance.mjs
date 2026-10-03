#!/usr/bin/env node
// A9 GATE-ITSELF BACKTEST (acceptance semantics, 2026-09-24).
//
// Replays the REAL campaign-9 and campaign-10 arms from the historian genome's
// read-only ledger archives through the NEW evaluate(), each against its
// GATE-TIME variance bank: campaigns strictly earlier + the replayed
// campaign's incumbent row, never its own candidate row (that row is written
// only after evaluate returns) and never future campaigns. Mandated verdicts:
//   C10 real ⇒ non-nominated   C9 real ⇒ non-nominated
//   synthetic +0.25 shift on the c10 arms ⇒ nominated
//   synthetic +0.05 shift on the c10 arms ⇒ culled
// Plus two honesty replays: C3 (the one true historical improvement) must stay
// nominated, and the B′ lucky-draw leak is reported with its exact P.
//
// READ-ONLY by construction: touches .state only through loadScoreBank
// (readdirSync/readFileSync) and its own JSONL parse for the arms.
// Usage: node scripts/backtest-acceptance.mjs [genomeRepoPath]

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { loadScoreBank } from "../dist/core/evolve/score-bank.js";
import { evaluate } from "../dist/core/stats.js";

const repoArg = process.argv[2];
if (repoArg === undefined) {
  console.error("usage: node scripts/backtest-acceptance.mjs <genomeRepoPath>  (the genome repo whose read-only .state/abathur/ledger*.jsonl holds the campaign archives)");
  process.exit(2);
}
const repo = path.resolve(repoArg);
const STATE = path.join(repo, ".state", "abathur");
const HIST_STATS = { halfWidth: 0.15, minEffect: 0.1, nReps: { initial: 2, max: 3 } };
const CAPS = { maxCandidates: 1, maxModelCalls: 96, maxTokens: 25_000_000, maxWallS: 16_200 };

/**
 * Gate-time counters for campaign `no`: the run-loop hands evaluate() the
 * ledger total minus the candidate's own slot (a self-tripped cap would make
 * the only candidate of a full-budget run permanently inconclusive). Real
 * tokens/wallS are summed from that campaign's own incumbent + candidate rows.
 */
function gateCounters(rows, file, treeSha) {
  const camp = rows.filter((r) => r.file === file);
  let tokens = 0;
  let wallS = 0;
  for (const r of camp) {
    if (r.source === "candidate" && (r.treeSha ?? "").startsWith(treeSha)) continue;
    tokens += r.counters.tokens;
    wallS += r.counters.wallS;
  }
  return { candidates: 0, modelCalls: 0, tokens, wallS: Number(wallS.toFixed(3)) };
}

/** All generation_complete rows, parsed read-only, per ledger file. */
function allRows() {
  const rows = [];
  for (const file of readdirSync(STATE).filter((n) => n.startsWith("ledger") && n.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(path.join(STATE, file), "utf8").split("\n")) {
      if (line.trim().length === 0) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.kind !== "generation_complete") continue;
      rows.push({ file, ...record.data });
    }
  }
  return rows;
}

const rows = allRows();
const rowOf = (tree12) => rows.find((r) => r.source === "candidate" && (r.treeSha ?? "").startsWith(tree12));
const incumbentAt = (head12, file) => rows.find((r) => r.source === "incumbent" && r.headCommit.startsWith(head12) && r.file === file);

const replicates = (row) => row.units.map((u) => ({ unitId: u.unitId, split: u.split, scores: [...u.scores] }));
const clone = (row) => ({ units: replicates(row) });
const withScores = (units, unitId, scores) => units.map((u) => (u.unitId === unitId ? { ...u, scores } : u));

const filesNewerThan = (campaignNo) =>
  rows.filter((r) => {
    const m = /^ledger\.campaign(\d+)-/.exec(r.file);
    if (m !== null) return Number(m[1]) > campaignNo;
    return r.file === "ledger.jsonl" && campaignNo < 10;
  }).map((r) => r.file);

function replay(label, { incumbentRow, candidateUnits, campaignFile, campaignNo, candidateTree, attackUnit, expect }) {
  const bank = loadScoreBank(repo, {
    excludeCandidateTrees: [candidateRow(candidateTree)],
    excludeFiles: filesNewerThan(campaignNo),
  });
  if (bank === null) throw new Error(`${label}: bank is null — replay premise violated (${STATE})`);
  const verdict = evaluate({
    candidate: { runId: label, counters: gateCounters(rows, campaignFile, candidateTree), units: candidateUnits },
    incumbent: { units: replicates(incumbentRow) },
    stats: HIST_STATS,
    budgetCaps: CAPS,
    nPairs: 1,
    bank: bank.units,
  });
  const a = verdict.acceptance;
  const atk = attackUnit === undefined ? undefined : bank.units.get(attackUnit);
  const sigmaLine = atk === undefined ? "" : ` [attack ${attackUnit}: σ_bank=${atk.sigma.toFixed(4)} df=${String(atk.df)}]`;
  console.log(
    `${label.padEnd(34)} → ${verdict.verdict.toUpperCase().padEnd(13)} gain=${verdict.gain === null ? "null" : verdict.gain.toFixed(4).padStart(8)} ` +
      `P(Δ>0)=${a?.pShift === null || a?.pShift === undefined ? "n/a" : a.pShift.toFixed(4)} q=${a === undefined ? "n/a" : a.q.toFixed(3)} se=${a?.gainSe === null || a?.gainSe === undefined ? "n/a" : a.gainSe.toFixed(4)}` +
      sigmaLine,
  );
  for (const u of a?.units ?? []) {
    console.log(
      `    val ${u.unitId}: σ=${u.sigma.toFixed(4)} df=${String(u.df)} Δ=${u.delta.toFixed(4)} se=${u.se.toFixed(4)} band=${u.band.toFixed(4)} P(regress≤−0.15)=${u.pRegression.toFixed(4)}`,
    );
  }
  for (const f of verdict.failures) console.log(`    gate: ${f}`);
  const ok = verdict.verdict === expect;
  console.log(`    expectation: ${expect} → ${ok ? "PASS" : "FAIL"}`);
  if (!ok) failures.push(label);
  return verdict;
}

let candidateRowCache = {};
function candidateRow(tree12) {
  if (candidateRowCache[tree12] === undefined) {
    const r = rowOf(tree12);
    if (r === undefined) throw new Error(`candidate row with tree ${tree12} not found`);
    candidateRowCache[tree12] = r.treeSha;
  }
  return candidateRowCache[tree12];
}

const failures = [];

// ---- C10 (r10: s19 train; guards s13,s14,s15,s16,s18 val) — gate-time bank
// excludes only its own candidate row (no future campaigns exist).
const c10Inc = incumbentAt("de607dab", "ledger.jsonl");
const c10Cand = rowOf("bb347b98");
if (c10Inc === undefined || c10Cand === undefined) throw new Error("campaign-10 rows missing — archive layout changed?");
console.log("campaign-10 incumbent s19:", JSON.stringify(c10Inc.units.find((u) => u.unitId === "scenario-19").scores),
  "candidate:", JSON.stringify(c10Cand.units.find((u) => u.unitId === "scenario-19").scores), "\n");

replay("C10 REAL (noise twin of champion)", {
  incumbentRow: c10Inc,
  candidateUnits: replicates(c10Cand),
  campaignFile: "ledger.jsonl",
  campaignNo: 10,
  candidateTree: "bb347b98",
  attackUnit: "scenario-19",
  expect: "culled",
});
replay("SYNTH A (+0.25 true shift)", {
  incumbentRow: c10Inc,
  candidateUnits: withScores(replicates(c10Cand), "scenario-19", [0.75, 0.75]),
  campaignFile: "ledger.jsonl",
  campaignNo: 10,
  candidateTree: "bb347b98",
  attackUnit: "scenario-19",
  expect: "nominated",
});
replay("SYNTH B (+0.05 band-mean draw)", {
  incumbentRow: c10Inc,
  candidateUnits: withScores(replicates(c10Cand), "scenario-19", [0.625, 0.5]),
  campaignFile: "ledger.jsonl",
  campaignNo: 10,
  candidateTree: "bb347b98",
  attackUnit: "scenario-19",
  expect: "culled",
});
replay("SYNTH B' (+0.05 lucky draw) [leak]", {
  incumbentRow: c10Inc,
  candidateUnits: withScores(replicates(c10Cand), "scenario-19", [0.625, 0.625]),
  campaignFile: "ledger.jsonl",
  campaignNo: 10,
  candidateTree: "bb347b98",
  attackUnit: "scenario-19",
  expect: "nominated",
});

// ---- C9 (r9: s18 train; guards s13-s16 val) — gate-time bank must not see c10.
const c9File = "ledger.campaign9-2026-09-23.jsonl";
const c9Inc = incumbentAt("8fe7e34a", c9File);
const c9Cand = rowOf("20290dd0");
if (c9Inc === undefined || c9Cand === undefined) throw new Error("campaign-9 rows missing");
replay("C9 REAL (probe-staleness epoch)", {
  incumbentRow: c9Inc,
  candidateUnits: replicates(c9Cand),
  campaignFile: c9File,
  campaignNo: 9,
  candidateTree: "20290dd0",
  attackUnit: "scenario-18",
  expect: "culled",
});

// ---- C3 replay: the one true historical improvement (gain +0.15625,
// promoted to 7ca80d7) — the instrument must still catch its own one proof.
const c3File = "ledger.campaign3-2026-09-17.jsonl";
const c3Inc = incumbentAt("6ca3ff68", c3File);
const c3Cand = rowOf("e5e4759c");
if (c3Inc === undefined || c3Cand === undefined) throw new Error("campaign-3 rows missing");
replay("C3 REAL (true +0.156 improve, promote)", {
  incumbentRow: c3Inc,
  candidateUnits: replicates(c3Cand),
  campaignFile: c3File,
  campaignNo: 3,
  candidateTree: "e5e4759c",
  attackUnit: "scenario-10",
  expect: "nominated",
});

// ---- legacy-path contrast: c10 through the SAME evaluate WITHOUT a bank
// (null ⇒ pre-redesign gate) — reproduces the 1.5883 absurdity on record.
const legacy = evaluate({
  candidate: { runId: "C10 legacy contrast", counters: gateCounters(rows, "ledger.jsonl", "bb347b98"), units: replicates(c10Cand) },
  incumbent: { units: replicates(c10Inc) },
  stats: HIST_STATS,
  budgetCaps: CAPS,
  nPairs: 1,
});
console.log("\nC10 legacy contrast (bank=null, pre-redesign gate):", legacy.verdict);
for (const f of legacy.failures) console.log(`    gate: ${f}`);
if (!legacy.failures.some((f) => f.includes("1.5883"))) failures.push("legacy contrast must surface the 1.5883 half-width");

const lifetime = loadScoreBank(repo);
console.log(`\nbank (full lifetime, for reference): prior σ=${lifetime.priorSigma.toFixed(4)} pooled df=${String(lifetime.totalDf)}`);
if (failures.length > 0) {
  console.error(`BACKTEST FAILURES: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("ALL BACKTEST VERDICTS MATCH THE MANDATE");
