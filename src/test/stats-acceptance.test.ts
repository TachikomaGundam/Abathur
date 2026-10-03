// Acceptance-semantics evaluate() tests (2026-09-24 redesign). Thresholds
// mirror the LIVE historian genome: halfWidth 0.15, minEffect 0.1. Bank σ
// values are the real campaign-10 gate-time bank (§2.3 of
// .omo/evidence/ACCEPTANCE-SEMANTICS-DESIGN.md); expected probabilities are
// from the independent python design-time replication (math.erf), asserted to
// 2e-5 — well above the A&S normalCdf error (< 1.5e-7) and far below any
// decision-relevant margin.
//
// Coverage law: every new branch (acceptance band, regression veto, point-mass
// se=0 branches, per-unit legacy fallback, aggregate P-gate, pool-incomplete
// legacy point-gain, q_pair tightening) plus the fail-closed law RE-PROVEN
// WITH A BANK PRESENT (budget/one-sided/exclusion cannot be bypassed).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCEPT_Q,
  aggregateScore,
  bonferroniQ,
  evaluate,
  normalCdf,
  studentTQuantile,
  type BudgetCaps,
  type BudgetCounters,
  type CandidateResult,
  type IncumbentResult,
  type UnitBankStat,
  type UnitReplicates,
} from "../core/stats.js";
import { BANK_QUANTUM } from "../core/evolve/score-bank.js";
import type { BenchStats } from "../core/spec.js";

const HIST_STATS: BenchStats = { halfWidth: 0.15, minEffect: 0.1, nReps: { initial: 2, max: 3 } };
const CAPS: BudgetCaps = { maxCandidates: 1, maxModelCalls: 96, maxTokens: 25_000_000, maxWallS: 16_200 };
const IDLE: BudgetCounters = { candidates: 0, modelCalls: 0, tokens: 1_000_000, wallS: 11_154 };

/** Gate-time c10 bank: σ values from the real archive pool (python replication). */
const HIST_BANK = new Map<string, UnitBankStat>([
  ["scenario-13", { sigma: 0.0170, df: 12 }],
  ["scenario-14", { sigma: 0.0176, df: 11 }],
  ["scenario-15", { sigma: 0.0884, df: 4 }],
  ["scenario-16", { sigma: 0.1053, df: 4 }],
  ["scenario-18", { sigma: 0.1113, df: 4 }],
  ["scenario-19", { sigma: 0.0884, df: 2 }],
]);

function units(specs: ReadonlyArray<readonly [string, "train" | "val", readonly number[]]>): UnitReplicates[] {
  return specs.map(([unitId, split, scores]) => ({ unitId, split, scores }));
}

const C10_INCUMBENT = units([
  ["scenario-19", "train", [0.5, 0.5]],
  ["scenario-13", "val", [1, 1]],
  ["scenario-14", "val", [1, 1]],
  ["scenario-15", "val", [1, 1]],
  ["scenario-16", "val", [1, 1]],
  ["scenario-18", "val", [0.75, 1]],
]);

function c10Candidate(s19: readonly number[], s16: readonly number[] = [0.75, 1], s18: readonly number[] = [1, 0.75]): CandidateResult {
  return {
    runId: "backtest",
    counters: IDLE,
    units: units([
      ["scenario-19", "train", s19],
      ["scenario-13", "val", [1, 1]],
      ["scenario-14", "val", [1, 1]],
      ["scenario-15", "val", [1, 1]],
      ["scenario-16", "val", s16],
      ["scenario-18", "val", s18],
    ]),
  };
}

function inc(unitsList: readonly UnitReplicates[]): IncumbentResult {
  return { units: unitsList };
}

function runAccept(candidate: CandidateResult, incumbentUnits: readonly UnitReplicates[] = C10_INCUMBENT, bank: ReadonlyMap<string, UnitBankStat> | null | undefined = HIST_BANK, nPairs = 1) {
  return evaluate({ candidate, incumbent: inc(incumbentUnits), stats: HIST_STATS, budgetCaps: CAPS, nPairs, ...(bank === undefined ? {} : { bank }) });
}

const close = (actual: number, expected: number, msg?: string): void => {
  assert.ok(Math.abs(actual - expected) < 2e-5, `${msg ?? ""} actual=${String(actual)} expected=${String(expected)}`);
};

// ---------------------------------------------------------------------------
// The four mandated backtests, as unit-pinned replicas of the real replays.
// ---------------------------------------------------------------------------

describe("acceptance gate — campaign replays", () => {
  it("C10 REAL stays CULLED: gain floor AND P=0.5000; the s16 noise dip is TOLERATED, not CI-fatal", () => {
    const v = runAccept(c10Candidate([0.5, 0.5]));
    assert.equal(v.verdict, "culled");
    assert.equal(v.exitCode, 1);
    assert.equal(v.gain, 0);
    assert.ok(v.acceptance !== undefined);
    close(v.acceptance.pShift ?? Number.NaN, 0.5, "pShift");
    assert.ok(v.failures.some((f) => f === "gain 0.0000 < minEffect 0.1000"));
    assert.ok(v.failures.some((f) => f.includes("P(gain shift > 0) = 0.5000 < q 0.9000")));
    assert.ok(!v.failures.some((f) => f.includes("CI half-width") || f.includes("acceptance band")), v.failures.join("\n"));
    const s16 = v.unitComparisons.find((u) => u.unitId === "scenario-16");
    assert.ok(s16 !== undefined);
    assert.equal(s16.passes, true, "one 0.125 step inside the 0.15 guard tolerance is noise, not regression");
    assert.equal(s16.ciPasses, true);
    const report16 = v.acceptance.units.find((u) => u.unitId === "scenario-16");
    assert.ok(report16 !== undefined);
    close(report16.pRegression, 0.40617, "P(regress) for the dip");
  });

  it("C9 REAL stays CULLED: negative point gain and P(Δ>0)≈0.046", () => {
    const c9Inc = units([
      ["scenario-18", "train", [0.875, 1]],
      ["scenario-13", "val", [1, 1]],
      ["scenario-14", "val", [1, 1]],
      ["scenario-15", "val", [1, 1]],
      ["scenario-16", "val", [1, 1]],
    ]);
    const c9Cand = units([
      ["scenario-18", "train", [0.75, 0.75]],
      ["scenario-13", "val", [1, 1]],
      ["scenario-14", "val", [1, 1]],
      ["scenario-15", "val", [1, 1]],
      ["scenario-16", "val", [1, 0.75]],
    ]);
    const v = runAccept({ runId: "c9", counters: IDLE, units: c9Cand }, c9Inc);
    assert.equal(v.verdict, "culled");
    close(v.gain ?? Number.NaN, -0.1875);
    const se = 0.1113;
    close(v.acceptance?.pShift ?? Number.NaN, normalCdf(-0.1875 / se), "pShift");
    assert.ok((v.acceptance?.pShift ?? 1) < 0.05);
  });

  it("SYNTH A (+0.25 true shift): NOMINATED at P≈0.9977 with the same guards (incl. the s16 dip)", () => {
    const v = runAccept(c10Candidate([0.75, 0.75]));
    assert.equal(v.verdict, "nominated");
    assert.equal(v.exitCode, 0);
    close(v.gain ?? Number.NaN, 0.25);
    close(v.acceptance?.pShift ?? Number.NaN, 0.99766, "pShift");
    assert.equal(v.acceptance?.q, ACCEPT_Q);
    assert.ok(v.failures.length === 0, v.failures.join("\n"));
  });

  it("SYNTH B (+0.05 band-mean draw): CULLED twice — gain 0.0625 < 0.1 and P≈0.7602", () => {
    const v = runAccept(c10Candidate([0.625, 0.5]));
    assert.equal(v.verdict, "culled");
    assert.ok(v.failures.some((f) => f.includes("gain 0.0625 < minEffect 0.1000")));
    assert.ok(v.failures.some((f) => f.includes("P(gain shift > 0) = 0.7602")));
  });

  it("documented leak SYNTH B′ (+0.05 lucky [0.625,0.625]): nominates at P≈0.9214 alone, culled at nPairs=2 (q=0.95)", () => {
    const solo = runAccept(c10Candidate([0.625, 0.625]));
    assert.equal(solo.verdict, "nominated");
    close(solo.acceptance?.pShift ?? Number.NaN, 0.92132, "pShift");
    const pair = runAccept(c10Candidate([0.625, 0.625]), C10_INCUMBENT, HIST_BANK, 2);
    assert.equal(pair.verdict, "culled");
    assert.equal(pair.acceptance?.q, 0.95);
    assert.ok(pair.failures.some((f) => f.includes("= 0.9213 < q 0.9500")), pair.failures.join("\n"));
  });
});

// ---------------------------------------------------------------------------
// Branch pins: each failure line and fallback edge of the new code.
// ---------------------------------------------------------------------------

describe("acceptance gate — branches", () => {
  it("gain ≥ minEffect with a loud point but weak P (σ=0.1113): P=0.8694 line fires, gain line absent", () => {
    const bank = new Map<string, UnitBankStat>([["t", { sigma: 0.1113, df: 4 }]]);
    const v = evaluate({
      candidate: { runId: "c", counters: IDLE, units: units([["t", "train", [0.625, 0.625]]]) },
      incumbent: inc(units([["t", "train", [0.5, 0.5]]])),
      stats: { ...HIST_STATS, halfWidth: 1 },
      budgetCaps: CAPS,
      nPairs: 1,
      bank,
    });
    assert.equal(v.verdict, "culled");
    assert.equal(v.failures.length, 1, v.failures.join("\n"));
    assert.ok(v.failures[0]?.includes("0.8693 < q 0.9000"), v.failures[0]);
  });

  it("point gain under floor with a confident P: only the legacy gain line fires", () => {
    const bank = new Map<string, UnitBankStat>([["t", { sigma: 0.017, df: 12 }]]);
    const v = evaluate({
      candidate: { runId: "c", counters: IDLE, units: units([["t", "train", [0.55, 0.6]]]) },
      incumbent: inc(units([["t", "train", [0.5, 0.5]]])),
      stats: { ...HIST_STATS, halfWidth: 1 },
      budgetCaps: CAPS,
      nPairs: 1,
      bank,
    });
    assert.equal(v.verdict, "culled");
    assert.deepEqual(v.failures, ["gain 0.0750 < minEffect 0.1000"]);
    assert.ok((v.acceptance?.pShift ?? 0) > 0.99);
  });

  it("hard guard regression vetoes: P(Δ ≤ −0.15)≈1 on a quiet bank unit", () => {
    const bank = new Map<string, UnitBankStat>([
      ["v", { sigma: 0.02, df: 8 }],
      ["t", { sigma: 0.017, df: 12 }],
    ]);
    const v = evaluate({
      candidate: { runId: "c", counters: IDLE, units: units([["v", "val", [0.75, 0.75]], ["t", "train", [1, 1]]]) },
      incumbent: inc(units([["v", "val", [1, 1]], ["t", "train", [1, 1]]])),
      stats: HIST_STATS,
      budgetCaps: CAPS,
      nPairs: 1,
      bank,
    });
    assert.equal(v.verdict, "culled");
    assert.ok(v.failures.some((f) => f.startsWith("regression on unit 'v'") && f.includes("≥ q 0.9000")), v.failures.join("\n"));
    assert.equal(v.unitComparisons.find((u) => u.unitId === "v")?.passes, false);
  });

  it("acceptance band breach: big bank σ ⇒ band 0.2718 > halfWidth culls even with zero delta", () => {
    const bank = new Map<string, UnitBankStat>([["v", { sigma: 0.3, df: 10 }], ["t", { sigma: 0.017, df: 12 }]]);
    const v = evaluate({
      candidate: { runId: "c", counters: IDLE, units: units([["v", "val", [1, 1]], ["t", "train", [1, 1]]]) },
      incumbent: inc(units([["v", "val", [1, 1]], ["t", "train", [1, 1]]])),
      stats: HIST_STATS,
      budgetCaps: CAPS,
      nPairs: 1,
      bank,
    });
    assert.equal(v.verdict, "culled");
    assert.ok(v.failures.some((f) => f.includes("acceptance band 0.2719 > halfWidth 0.1500 on unit 'v'")), v.failures.join("\n"));
  });

  it("banked val unit with NO history for the bank runs the exact legacy t-CI line — the 1.5883 absurdity survives only on this fallback path", () => {
    const bank = new Map<string, UnitBankStat>([["scenario-13", { sigma: 0.017, df: 12 }]]);
    const v = runAccept(c10Candidate([0.5, 0.5], [0.75, 1]), C10_INCUMBENT, bank);
    const expectedHalfWidth = studentTQuantile(0.05, 1) * 0.125;
    assert.ok(Math.abs(expectedHalfWidth - 1.5883) < 1e-4, "design-time arithmetic");
    assert.ok(v.failures.some((f) => f === `CI half-width ${expectedHalfWidth.toFixed(4)} > halfWidth 0.1500 on unit 'scenario-16'`), v.failures.join("\n"));
    assert.ok(v.acceptance !== undefined);
    assert.equal(v.acceptance.units.find((u) => u.unitId === "scenario-16"), undefined);
  });

  it("partial bank: train pool unpriced ⇒ aggregate falls back to the legacy point-gain gate; nomination still requires gain ≥ minEffect", () => {
    const partial = new Map<string, UnitBankStat>([...HIST_BANK].filter(([id]) => id !== "scenario-19"));
    const weak = runAccept(c10Candidate([0.625, 0.5]), C10_INCUMBENT, partial);
    assert.equal(weak.verdict, "culled");
    assert.ok(weak.failures.some((f) => f.includes("gain 0.0625 < minEffect 0.1000")));
    assert.equal(weak.acceptance?.pShift, null);
    assert.equal(weak.acceptance?.gainSe, null);
    const strong = runAccept(c10Candidate([0.75, 0.75]), C10_INCUMBENT, partial);
    assert.equal(strong.verdict, "nominated", "cold-start gate-time bank (no s19 rows yet) still accepts the +0.25 class via the legacy point gate");
    assert.equal(strong.acceptance?.pShift, null);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed law RE-PROVEN with a bank present — the bank never bypasses it.
// ---------------------------------------------------------------------------

describe("fail-closed law under an acceptance bank", () => {
  it("budget exhaustion ⇒ inconclusive (gain null, no comparisons, no acceptance math)", () => {
    const v = runAccept({ ...c10Candidate([0.75, 0.75]), counters: { ...IDLE, wallS: 16_200 } });
    assert.equal(v.verdict, "inconclusive");
    assert.equal(v.exitCode, 2);
    assert.equal(v.gain, null);
    assert.deepEqual(v.unitComparisons, []);
    assert.ok(v.failures.some((f) => f.includes("budget exhausted: wallS")));
  });

  it("one-sided n<2 ⇒ indeterminate even when the bank knows the unit", () => {
    const oneSided = units([
      ["scenario-19", "train", [0.75, 0.75]],
      ["scenario-13", "val", [1, 1]],
      ["scenario-14", "val", [1, 1]],
      ["scenario-15", "val", [1, 1]],
      ["scenario-16", "val", [1, 1]],
      ["scenario-18", "val", [1]],
    ]);
    const v = runAccept({ runId: "c", counters: IDLE, units: oneSided });
    assert.equal(v.verdict, "indeterminate");
    assert.equal(v.exitCode, 1);
    assert.equal(v.gain, null);
    assert.ok(v.failures.some((f) => f.includes("scenario-18") && f.includes("variance undefined")));
  });

  it("both-unmeasured ⇒ symmetric exclusion: dropped from comparisons, acceptance reports and the gain pool alike", () => {
    const withGhost = units([["ghost", "val", []], ...C10_INCUMBENT.map((u) => [u.unitId, u.split, [...u.scores]] as const)]);
    const cand = c10Candidate([0.75, 0.75]);
    const v = runAccept({ ...cand, units: [{ unitId: "ghost", split: "val", scores: [] }, ...cand.units] }, withGhost);
    assert.equal(v.verdict, "nominated");
    assert.ok(v.unitComparisons.every((u) => u.unitId !== "ghost"));
    assert.ok(v.acceptance !== undefined && v.acceptance.units.every((u) => u.unitId !== "ghost"));
    close(aggregateScore(withGhost.filter((u) => u.unitId !== "ghost")), aggregateScore(C10_INCUMBENT));
  });

  it("no reroll: evaluate is deterministic — identical inputs produce identical verdicts and acceptance numbers", () => {
    const a = runAccept(c10Candidate([0.75, 0.75]));
    const b = runAccept(c10Candidate([0.75, 0.75]));
    assert.deepEqual(a, b);
  });

  it("absent/null bank reproduces the legacy gate verbatim; the whole verdict object is unchanged", () => {
    const legacy = evaluate({ candidate: c10Candidate([0.5, 0.5]), incumbent: inc(C10_INCUMBENT), stats: HIST_STATS, budgetCaps: CAPS, nPairs: 1 });
    const nulled = runAccept(c10Candidate([0.5, 0.5]), C10_INCUMBENT, null);
    assert.deepEqual(nulled, legacy);
    assert.equal(legacy.acceptance, undefined);
    assert.equal(legacy.verdict, "culled");
    assert.ok(legacy.failures.some((f) => f.includes("CI half-width 1.5883")), "the campaign-10 legacy cull carried the absurd half-width line");
    const banked = runAccept(c10Candidate([0.5, 0.5]));
    assert.equal(banked.verdict, "culled");
    assert.ok(!banked.failures.some((f) => f.includes("CI half-width")), "acceptance path prices the dip instead of tripping on df=1 t");
  });

  it("point mass σ=0: se=0 branch — exact tie gives P=0 (no nomination on demonstrated-identical arms), a 0.25 guard drop vetoes at P=1, a 0.125 dip inside tolerance passes", () => {
    const bank = new Map<string, UnitBankStat>([
      ["v", { sigma: 0, df: 10 }],
      ["t", { sigma: 0, df: 10 }],
    ]);
    const tie = evaluate({
      candidate: { runId: "c", counters: IDLE, units: units([["v", "val", [1, 1]], ["t", "train", [1, 1]]]) },
      incumbent: inc(units([["v", "val", [1, 1]], ["t", "train", [1, 1]]])),
      stats: HIST_STATS,
      budgetCaps: CAPS,
      nPairs: 1,
      bank,
    });
    assert.equal(tie.verdict, "culled");
    assert.equal(tie.acceptance?.pShift, 0);
    assert.equal(tie.acceptance?.gainSe, 0);
    const hard = evaluate({
      candidate: { runId: "c", counters: IDLE, units: units([["v", "val", [0.75, 0.75]], ["t", "train", [1.3, 1.3]]]) },
      incumbent: inc(units([["v", "val", [1, 1]], ["t", "train", [1, 1]]])),
      stats: HIST_STATS,
      budgetCaps: CAPS,
      nPairs: 1,
      bank,
    });
    assert.equal(hard.verdict, "culled");
    assert.ok(hard.failures.some((f) => f.startsWith("regression on unit 'v'") && f.includes("= 1.0000")));
    const dip = evaluate({
      candidate: { runId: "c", counters: IDLE, units: units([["v", "val", [0.875, 0.875]], ["t", "train", [1.3, 1.3]]]) },
      incumbent: inc(units([["v", "val", [1, 1]], ["t", "train", [1, 1]]])),
      stats: HIST_STATS,
      budgetCaps: CAPS,
      nPairs: 1,
      bank,
    });
    assert.equal(dip.verdict, "nominated", "−0.125 sits inside the 0.15 guard tolerance — the anchor semantics");
  });
});

describe("acceptance constants + normal math", () => {
  it("ACCEPT_Q is 0.9 and bonferroniQ tightens it per pair, capped", () => {
    assert.equal(ACCEPT_Q, 0.9);
    assert.equal(bonferroniQ(1), 0.9);
    close(bonferroniQ(2), 0.95);
    close(bonferroniQ(10), 0.99);
    assert.equal(bonferroniQ(10_000), 0.9999);
    assert.throws(() => bonferroniQ(0), RangeError);
    assert.throws(() => bonferroniQ(1.5), RangeError);
  });

  it("normalCdf matches the tables and the quantile inverts it", () => {
    close(normalCdf(0), 0.5);
    close(normalCdf(1.2815515655446004), 0.9);
    close(normalCdf(-1.6448536269514722), 0.05);
    assert.equal(normalCdf(Number.POSITIVE_INFINITY), 1);
    assert.equal(normalCdf(Number.NEGATIVE_INFINITY), 0);
    assert.ok(Number.isNaN(normalCdf(Number.NaN)));
    for (const x of [-3, -1.28, 0, 0.7, 2.83]) {
      assert.ok(Math.abs(normalCdf(x) - (x < 0 ? 1 - normalCdf(-x) : normalCdf(x))) < 1e-12, "symmetry sanity");
    }
  });

  it("the bank quantum is 0.0884 — one flipped 1/8-grid item between two reps", () => {
    close(BANK_QUANTUM, 0.0884);
    assert.ok(Math.abs(BANK_QUANTUM - 0.125 / Math.SQRT2) < 1e-12);
  });
});
