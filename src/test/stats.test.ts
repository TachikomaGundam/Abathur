// Selection-stats tests (plan todo 7 ACs, literal): identical scores ⇒ not
// nominated; single val regression disqualifies; minEffect floor blocks tiny
// wins; two-candidate fixture exercises the Bonferroni alpha correction; Pareto
// set correctness on an 8-candidate fixture; cap-hit ⇒ inconclusive with
// counters surfaced; seeded synthetic replay ⇒ deterministic verdict table.
// Student-t CI: own inverse-t (bisection on the regularized incomplete beta),
// validated against known table values — NOTE: the plan's "df=2 ⇒ 2.920" is
// the t_{0.95} quantile (two-sided 90%); the two-sided 95% value is 4.303.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FAMILY_ALPHA,
  VERDICT_EXIT,
  aggregateScore,
  bonferroniAlpha,
  budgetExhausted,
  clampReps,
  evaluate,
  needsExit,
  paretoFrontier,
  seededRandom,
  studentTQuantile,
  summarizeUnit,
  type BudgetCaps,
  type BudgetCounters,
  type CandidateResult,
  type GateVerdict,
  type IncumbentResult,
  type ParetoPoint,
  type UnitReplicates,
  type Verdict,
} from "../core/stats.js";
import type { BenchStats } from "../core/spec.js";

// ---------------------------------------------------------------------------
// Fixture builders (engineered replicate arrays with EXACT sample variance).
// Across the whole file: family alpha 0.05, halfWidth and minEffect 0.05 —
// mirroring hr/thresholds toy discipline.
// ---------------------------------------------------------------------------

const STATS: BenchStats = { halfWidth: 0.05, minEffect: 0.05, nReps: { initial: 5, max: 10 } };
const CAPS: BudgetCaps = { maxCandidates: 8, maxModelCalls: 64, maxTokens: 2_000_000, maxWallS: 3600 };
const IDLE_COUNTERS: BudgetCounters = { candidates: 1, modelCalls: 8, tokens: 40_000, wallS: 120 };

/** Deviations [−2,−1,0,1,2] scaled to a target SAMPLE variance (n=5 ⇒ sem=√v/√5). */
function devs(targetVariance: number): readonly number[] {
  const c = Math.sqrt((targetVariance * 4) / 10); // Σdev² = 10, ddof = 4
  return [-2 * c, -c, 0, c, 2 * c];
}

function unit(unitId: string, split: "train" | "val", mean: number, variance: number): UnitReplicates {
  return { unitId, split, scores: devs(variance).map((d) => mean + d) };
}

/** Val-unit mean that makes the regression floor land EXACTLY on the tie (delta === −CI). */
function tieIncumbentValMean(candidateMean: number, variance: number, alpha: number): number {
  return candidateMean + studentTQuantile(alpha, 4) * Math.sqrt(variance / 5);
}

function candidate(runId: string, units: readonly UnitReplicates[], counters: BudgetCounters = IDLE_COUNTERS): CandidateResult {
  return { runId, units, counters };
}
function incumbent(units: readonly UnitReplicates[]): IncumbentResult {
  return { units };
}

function valOnlyUnits(mean: number, variance: number): readonly UnitReplicates[] {
  return [unit("u-val", "val", mean, variance)];
}
function trainValUnits(trainMean: number, valMean: number, variance: number): readonly UnitReplicates[] {
  return [unit("u-train", "train", trainMean, variance), unit("u-val", "val", valMean, variance)];
}

function summaryOf(v: GateVerdict): string {
  return `${v.verdict}(exit=${v.exitCode}, gain=${v.gain?.toFixed(3) ?? "null"}, alpha=${v.effectiveAlpha})`;
}

// ---------------------------------------------------------------------------
// Student-t quantile
// ---------------------------------------------------------------------------

describe("studentTQuantile", () => {
  const CASES: ReadonlyArray<readonly [number, number, number]> = [
    // [alpha (two-sided), df, expected t_{1−alpha/2}]
    [0.05, 1, 12.706],
    [0.05, 2, 4.303], // plan's "2.920" is the t_{0.95} column; 95% two-sided is 4.303
    [0.05, 9, 2.262],
    [0.05, 30, 2.042],
  ];
  for (const [alpha, df, expected] of CASES) {
    it(`reproduces t-table t_{0.975,df=${df}} = ${expected}`, () => {
      assert.ok(Math.abs(studentTQuantile(alpha, df) - expected) < 1e-3, `t=${studentTQuantile(alpha, df)}`);
    });
  }
  it("widens with the corrected (Bonferroni) alpha at df=4", () => {
    assert.ok(Math.abs(studentTQuantile(0.05, 4) - 2.776) < 1e-3);
    assert.ok(Math.abs(studentTQuantile(0.025, 4) - 3.495) < 1.5e-2);
    assert.ok(studentTQuantile(0.025, 4) > studentTQuantile(0.05, 4));
  });
  it("rejects alpha outside (0,1) and df < 1", () => {
    assert.throws(() => studentTQuantile(0, 4), RangeError);
    assert.throws(() => studentTQuantile(1, 4), RangeError);
    assert.throws(() => studentTQuantile(-0.5, 4), RangeError);
    assert.throws(() => studentTQuantile(0.05, 0), RangeError);
  });
});

// ---------------------------------------------------------------------------
// summarizeUnit / aggregateScore / clampReps / budgetExhausted
// ---------------------------------------------------------------------------

describe("summarizeUnit", () => {
  it("computes mean, unbiased variance and 95% CI half-width (n=5)", () => {
    const s = summarizeUnit(devs(0.0016));
    assert.ok(Math.abs(s.mean) < 1e-12);
    assert.ok(Math.abs(s.sampleVariance - 0.0016) < 1e-15);
    assert.ok(Math.abs(s.sem - Math.sqrt(0.0016 / 5)) < 1e-12);
    assert.ok(Math.abs(s.ciHalfWidth - studentTQuantile(FAMILY_ALPHA, 4) * s.sem) < 1e-9);
    assert.equal(s.indeterminate, false);
  });
  it("HARD RULE: n=1 ⇒ variance undefined ⇒ indeterminate", () => {
    const s = summarizeUnit([0.7]);
    assert.equal(s.indeterminate, true);
    assert.ok(Number.isNaN(s.sampleVariance));
    assert.ok(Number.isNaN(s.ciHalfWidth));
  });
});

describe("aggregateScore", () => {
  it("averages per-unit means over train units", () => {
    const units = [unit("t1", "train", 0.8, 0.001), unit("t2", "train", 0.9, 0.001)];
    assert.ok(Math.abs(aggregateScore(units) - 0.85) < 1e-12);
  });
  it("falls back to val units when the bench has no train units", () => {
    assert.ok(Math.abs(aggregateScore(valOnlyUnits(0.77, 0.001)) - 0.77) < 1e-12);
  });
});

describe("clampReps", () => {
  it("defaults to nReps.initial and clamps into [initial, max]", () => {
    assert.equal(clampReps(undefined, STATS.nReps), 5);
    assert.equal(clampReps(1, STATS.nReps), 5); // --reps 1 ⇒ initial (never below)
    assert.equal(clampReps(5, STATS.nReps), 5);
    assert.equal(clampReps(50, STATS.nReps), 10); // --reps 50 ⇒ max
    assert.equal(clampReps(Number.NaN, STATS.nReps), 5); // non-finite ⇒ initial
  });
});

describe("budgetExhausted", () => {
  it("fires when ANY cap is hit (>=), and only then", () => {
    assert.equal(budgetExhausted(IDLE_COUNTERS, CAPS), false);
    assert.equal(budgetExhausted({ ...IDLE_COUNTERS, candidates: 8 }, CAPS), true);
    assert.equal(budgetExhausted({ ...IDLE_COUNTERS, modelCalls: 64 }, CAPS), true);
    assert.equal(budgetExhausted({ ...IDLE_COUNTERS, tokens: 2_000_000 }, CAPS), true);
    assert.equal(budgetExhausted({ ...IDLE_COUNTERS, wallS: 3600 }, CAPS), true);
    assert.equal(budgetExhausted({ ...IDLE_COUNTERS, tokens: 1_999_999 }, CAPS), false);
  });
});

// ---------------------------------------------------------------------------
// Nomination gate (evaluate)
// ---------------------------------------------------------------------------

describe("evaluate: identical scores are never nominated", () => {
  it("mirror-image candidate with minEffect > 0 ⇒ culled (gain 0)", () => {
    const v = evaluate({
      candidate: candidate("g-ident", trainValUnits(0.8, 0.8, 0.0015)),
      incumbent: incumbent(trainValUnits(0.8, 0.8, 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "culled");
    assert.ok(v.failures.some((f) => f.startsWith("gain")));
  });
});

describe("evaluate: single val-unit regression disqualifies", () => {
  it("mirror-image all val units except one below incumbent − CI ⇒ culled", () => {
    // CI at df=4, family alpha 0.05: t≈2.776, sem=√0.0016/√5≈0.0179 ⇒ CI≈0.0497
    const v = evaluate({
      candidate: candidate("g-reg", [
        unit("u-train", "train", 0.85, 0.0016),
        unit("u-val-1", "val", 0.8, 0.0016),
        unit("u-val-2", "val", 0.7, 0.0016), // incumbent 0.8: floor ≈ 0.7503 ⇒ regresses
      ]),
      incumbent: incumbent([
        unit("u-train", "train", 0.7, 0),
        unit("u-val-1", "val", 0.8, 0),
        unit("u-val-2", "val", 0.8, 0),
      ]),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "culled");
    assert.ok(v.failures.some((f) => f.startsWith("regression on unit 'u-val-2'")));
    const comp = v.unitComparisons.find((c) => c.unitId === "u-val-2");
    assert.ok(comp !== undefined && !comp.passes);
  });
});

describe("evaluate: minEffect floor blocks tiny wins", () => {
  it("candidate with gain 0.03 < minEffect 0.05 and tight CI ⇒ culled on gain", () => {
    const v = evaluate({
      candidate: candidate("g-tiny", trainValUnits(0.73, 0.795, 0.0004)), // CI ≈ 2.776·√0.0004/√5 ≈ 0.0248
      incumbent: incumbent(trainValUnits(0.7, 0.8, 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "culled");
    assert.ok(v.failures.some((f) => f.startsWith("gain")));
  });
});

describe("evaluate: CI half-width gate", () => {
  it("candidate whose per-unit CI exceeds halfWidth is culled even with big gain", () => {
    // variance 0.01 ⇒ sem=√0.002≈0.0447, CI ≈ 0.124 > halfWidth 0.05
    const v = evaluate({
      candidate: candidate("g-wide", trainValUnits(0.9, 0.9, 0.01)),
      incumbent: incumbent(trainValUnits(0.7, 0.8, 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "culled");
    assert.ok(v.failures.some((f) => f.startsWith("CI half-width")));
  });
});

describe("evaluate: Bonferroni alpha correction (plan AC)", () => {
  // Candidate A: CI at family α=0.05 (sem 0.017 ⇒ CI05≈0.0472) fits halfWidth 0.05;
  // corrected α=0.025 (sem 0.017 ⇒ CI025≈0.0594) does NOT. Candidate B: sem 0.010
  // (CI025≈0.0349) passes even corrected. Margins ≥ 18%.
  function aUnits(): readonly UnitReplicates[] {
    return trainValUnits(0.85, 0.85, 0.001445); // sem = √0.001445/√5 = 0.017
  }
  function bUnits(): readonly UnitReplicates[] {
    return trainValUnits(0.75, 0.8, 0.0005);
  }
  it("single pair: candidate A wins under family alpha 0.05", () => {
    const v = evaluate({
      candidate: candidate("g-A", aUnits()),
      incumbent: incumbent(trainValUnits(0.7, 0.8, 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "nominated", summaryOf(v));
    assert.equal(v.exitCode, 0);
  });
  it("two candidates vs one incumbent: Bonferroni correction flips A to culled, B still nominated", () => {
    const inc = incumbent(trainValUnits(0.7, 0.8, 0));
    const va = evaluate({ candidate: candidate("g-A", aUnits()), incumbent: inc, stats: STATS, budgetCaps: CAPS, nPairs: 2 });
    const vb = evaluate({ candidate: candidate("g-B", bUnits()), incumbent: inc, stats: STATS, budgetCaps: CAPS, nPairs: 2 });
    assert.equal(va.effectiveAlpha, 0.025);
    assert.equal(va.verdict, "culled", summaryOf(va)); // flip: winner at 0.05 fails at 0.025
    assert.equal(vb.verdict, "nominated", summaryOf(vb)); // control survives the correction
  });
  it("bonferroniAlpha divides the family constant", () => {
    assert.equal(bonferroniAlpha(1), 0.05);
    assert.equal(bonferroniAlpha(2), 0.025);
    assert.throws(() => bonferroniAlpha(0), RangeError);
  });
});

describe("evaluate: n=1 ⇒ indeterminate, never nominated", () => {
  it("one val unit measured once ⇒ indeterminate even though other gates pass", () => {
    const v = evaluate({
      candidate: candidate("g-n1", [unit("u-train", "train", 0.85, 0.001), { unitId: "u-val", split: "val", scores: [0.9] }]),
      incumbent: incumbent(trainValUnits(0.7, 0.8, 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "indeterminate");
    assert.ok(v.failures.some((f) => f.includes("variance undefined")));
    assert.notEqual(v.exitCode, 0);
  });
  it("candidate missing an incumbent val unit entirely ⇒ indeterminate", () => {
    const v = evaluate({
      candidate: candidate("g-miss", [unit("u-train", "train", 0.85, 0.001)]),
      incumbent: incumbent(trainValUnits(0.7, 0.8, 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "indeterminate");
  });
});

describe("evaluate: budget exhaustion ⇒ inconclusive, never implicit pass", () => {
  it("outstanding metrics + a consumed cap still ⇒ inconclusive with counters surfaced", () => {
    const v = evaluate({
      candidate: candidate("g-budget", trainValUnits(0.95, 0.95, 0.0001), {
        candidates: 8,
        modelCalls: 60,
        tokens: 1_800_000,
        wallS: 3200,
      }),
      incumbent: incumbent(trainValUnits(0.7, 0.8, 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "inconclusive");
    assert.equal(v.exitCode, 2);
    assert.equal(v.counters.candidates, 8); // counters surfaced
    assert.equal(v.unitComparisons.length, 0); // excluded from comparison series
    assert.ok(v.failures.some((f) => f.includes("candidates=8/8")));
  });
});

describe("evaluate: nomination happy path", () => {
  it("tight CI, gain above floor, no regression ⇒ nominated with per-unit comparisons", () => {
    const v = evaluate({
      candidate: candidate("g-ok", trainValUnits(0.85, 0.85, 0.0004)),
      incumbent: incumbent(trainValUnits(0.7, 0.78, 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "nominated", summaryOf(v));
    assert.equal(v.failures.length, 0);
    assert.equal(v.unitComparisons.length, 1);
    const comp = v.unitComparisons[0];
    assert.ok(comp !== undefined && comp.passes);
  });
  it("regression floor allows an exact tie (mean delta === −CI)", () => {
    const candMean = 0.8;
    const variance = 0.0016;
    const v = evaluate({
      candidate: candidate("g-tie", trainValUnits(0.85, candMean, variance)),
      incumbent: incumbent(trainValUnits(0.7, tieIncumbentValMean(candMean, variance, 0.05), 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "nominated", summaryOf(v));
  });
  it("val-only bench (no train units) measures gain on the val aggregate", () => {
    const v = evaluate({
      candidate: candidate("g-valonly", valOnlyUnits(0.85, 0.0004)),
      incumbent: incumbent(valOnlyUnits(0.75, 0)),
      stats: STATS,
      budgetCaps: CAPS,
      nPairs: 1,
    });
    assert.equal(v.verdict, "nominated", summaryOf(v));
  });
});

describe("needsExit verdict→exit mapping (todo 9 consumes)", () => {
  it("maps nominated→0, culled→1, indeterminate→1, inconclusive→2", () => {
    assert.equal(needsExit("nominated"), 0);
    assert.equal(needsExit("culled"), 1);
    assert.equal(needsExit("indeterminate"), 1);
    assert.equal(needsExit("inconclusive"), 2);
    assert.deepEqual(VERDICT_EXIT, { nominated: 0, culled: 1, indeterminate: 1, inconclusive: 2 });
  });
});

// ---------------------------------------------------------------------------
// Pareto frontier (8-candidate fixture with known dominated/frontier structure)
// ---------------------------------------------------------------------------

describe("paretoFrontier", () => {
  const POINTS: readonly ParetoPoint[] = [
    { id: "P8", trainScore: 0.99, tokens: 200, wallS: 20, complete: true },
    { id: "P1", trainScore: 0.95, tokens: 100, wallS: 10, complete: true },
    { id: "P3", trainScore: 0.95, tokens: 120, wallS: 10, complete: true }, // dominated by P1
    { id: "P2", trainScore: 0.9, tokens: 60, wallS: 8, complete: true },
    { id: "P5", trainScore: 0.9, tokens: 60, wallS: 9, complete: true }, // dominated by P2
    { id: "P4", trainScore: 0.85, tokens: 50, wallS: 6, complete: true },
    { id: "P6", trainScore: 0.7, tokens: 30, wallS: 4, complete: true },
    { id: "P7", trainScore: 0.7, tokens: 30, wallS: 4, complete: true }, // exact tie with P6
    { id: "TRUNC", trainScore: 1.0, tokens: 10, wallS: 1, complete: false }, // never enters
  ];
  const FRONTIER = new Set(["P8", "P1", "P2", "P4", "P6", "P7"]);

  it("returns exactly the non-dominated complete candidates, ranked by score", () => {
    const ranked = paretoFrontier(POINTS, 1);
    assert.deepEqual(new Set(ranked), FRONTIER);
    assert.equal(ranked[0], "P8");
    assert.equal(ranked[1], "P1");
    assert.equal(ranked[2], "P2");
    assert.equal(ranked[3], "P4");
    assert.ok(!ranked.includes("P3") && !ranked.includes("P5") && !ranked.includes("TRUNC"));
  });
  it("budget-truncated generations never enter the Pareto set", () => {
    const ranked = paretoFrontier(
      [{ id: "T", trainScore: 1.0, tokens: 10, wallS: 1, complete: false }, { id: "OK", trainScore: 0.6, tokens: 40, wallS: 5, complete: true }],
      1,
    );
    assert.deepEqual(ranked, ["OK"]);
  });
  it("exact ties share a deterministic rank order per seed", () => {
    const a = paretoFrontier(POINTS, 7);
    const b = paretoFrontier(POINTS, 7);
    assert.deepEqual(a, b);
    assert.equal(a.length, 6);
    assert.ok(new Set(a.slice(4)).has("P6") && new Set(a.slice(4)).has("P7"));
  });
});

// ---------------------------------------------------------------------------
// Seeded synthetic replay: fixed seed ⇒ exact verdict table
// ---------------------------------------------------------------------------

describe("seeded synthetic replay (plan AC: deterministic verdict table)", () => {
  const SEED = 42;

  function noisyUnit(unitId: string, split: "train" | "val", mean: number, variance: number, rng: () => number): UnitReplicates {
    return { unitId, split, scores: devs(variance).map((d) => mean + d + (rng() - 0.5) * 0.01) };
  }

  it("reproduces the exact verdict for every row of the decision table", () => {
    const inc = incumbent([
      unit("u-train", "train", 0.7, 0),
      unit("u-val", "val", 0.8, 0),
    ]);
    const rows: Array<{ name: string; candUnits: readonly UnitReplicates[]; caps: BudgetCaps; nPairs: number; expected: Verdict }> = [];

    const rngA = seededRandom(SEED);
    const rngB = seededRandom(SEED + 1);
    const rngC = seededRandom(SEED + 2);
    const rngD = seededRandom(SEED + 3);
    const rngE = seededRandom(SEED + 4);

    rows.push(
      {
        name: "clear winner (nominate)",
        candUnits: [noisyUnit("u-train", "train", 0.85, 0.0004, rngA), noisyUnit("u-val", "val", 0.88, 0.0004, rngA)],
        caps: CAPS,
        nPairs: 1,
        expected: "nominated",
      },
      {
        name: "tiny gain (cull)",
        candUnits: [noisyUnit("u-train", "train", 0.72, 0.0004, rngB), noisyUnit("u-val", "val", 0.82, 0.0004, rngB)],
        caps: CAPS,
        nPairs: 1,
        expected: "culled",
      },
      {
        name: "val regression (cull)",
        candUnits: [noisyUnit("u-train", "train", 0.9, 0.0004, rngC), noisyUnit("u-val", "val", 0.72, 0.0004, rngC)],
        caps: CAPS,
        nPairs: 1,
        expected: "culled",
      },
      {
        name: "single measurement (indeterminate)",
        candUnits: [noisyUnit("u-train", "train", 0.85, 0.0004, rngD), { unitId: "u-val", split: "val", scores: [0.88] }],
        caps: CAPS,
        nPairs: 1,
        expected: "indeterminate",
      },
      {
        name: "budget spent (inconclusive)",
        candUnits: [noisyUnit("u-train", "train", 0.95, 0.0004, rngE), noisyUnit("u-val", "val", 0.95, 0.0004, rngE)],
        caps: { ...CAPS, maxTokens: 40_000 }, // IDLE_COUNTERS.tokens === cap ⇒ exhausted
        nPairs: 1,
        expected: "inconclusive",
      },
    );

    const table = rows.map((row) => {
      const v = evaluate({
        candidate: candidate(`g-${row.name.replace(/\W+/g, "-")}`, row.candUnits),
        incumbent: inc,
        stats: STATS,
        budgetCaps: row.caps,
        nPairs: row.nPairs,
      });
      return `${row.name.padEnd(28)} → ${summaryOf(v)}`;
    });
    for (const [i, row] of rows.entries()) {
      assert.equal(evaluate({
        candidate: candidate(`g-${row.name.replace(/\W+/g, "-")}`, row.candUnits),
        incumbent: inc,
        stats: STATS,
        budgetCaps: row.caps,
        nPairs: row.nPairs,
      }).verdict, row.expected, table[i]);
    }
  });
});