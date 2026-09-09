// Selection statistics (plan todo 7): nomination gates, Bonferroni correction,
// Pareto ranking, budget-inconclusive verdicts. PURE functions only — budget
// counters arrive as plain inputs, the seed is injectable, every threshold
// comes from GenomeSpec.bench.stats (spec.ts), no I/O, no Date.now().
//
// SEMANTICS (plan-literal):
//  - per-unit mean over nReps; the runner clamps nReps via clampReps (fixed
//    count, no sequential escalation in v1). HARD RULE: n<2 on ANY candidate
//    unit ⇒ variance undefined ⇒ verdict indeterminate, NEVER nominated; a
//    val unit missing from the candidate entirely is the n=0 case of the same
//    rule.
//  - nomination gate (all three must hold, per pair): (1) CI half-width of the
//    candidate's per-unit sample mean (95% Student-t, two-sided) ≤
//    stats.halfWidth on every val unit of the incumbent's suite; (2) gain
//    (aggregate train mean over the unit means, val-aggregate fallback when
//    the bench has no train units) ≥ stats.minEffect; (3) no val regression:
//    per-unit val mean ≥ incumbent mean − that unit's CI half-width (ties
//    allowed ⇒ passes ⇔ delta ≥ −ciHalfWidth, evaluated with the SAME
//    corrected alpha).
//  - Bonferroni: family alpha 0.05 constant across finalist pairs; each pair's
//    CI uses the corrected alpha FAMILY_ALPHA / nPairs (never configurable).
//  - budget exhaustion (any cap at/above, counters vs caps) ⇒ inconclusive
//    (exit 2 via VERDICT_EXIT), excluded from the comparison series, never an
//    implicit pass. The gate itself is RNG-free; the only tie-break in this
//    module is Pareto rank order, which takes an injectable seed.
//  - Pareto over (trainScore, tokens, wallS); budget-truncated generations
//    (complete:false) never enter the set.
//
// The inverse Student-t is implemented here (bisection on the regularized
// incomplete beta, Numerical-Recipes-style continued fraction) — a new dep is
// forbidden by the plan. Accuracy: |t − table| < 1e-3 for the t-distribution
// table values checked in stats.test.ts (df=1..30, α=0.05).

import { EXIT_BLOCKED, EXIT_CANNOT_ANSWER, EXIT_OK, type ExitCode } from "../exit.js";
import type { BenchStats } from "./spec.js";

export interface BudgetCounters {
  readonly candidates: number;
  readonly modelCalls: number;
  readonly tokens: number;
  readonly wallS: number;
}

/** Mirrors GenomeSpec.budget field names (load-bearing). */
export interface BudgetCaps {
  readonly maxCandidates: number;
  readonly maxModelCalls: number;
  readonly maxTokens: number;
  readonly maxWallS: number;
}

/** Per-unit replicate scores (train and val units alike). */
export interface UnitReplicates {
  readonly unitId: string;
  readonly split: "train" | "val";
  readonly scores: readonly number[];
}

/** Per-unit summary of replicate scores; n<2 ⇒ indeterminate (variance NaN). */
export interface UnitStat {
  readonly n: number;
  readonly mean: number;
  readonly sampleVariance: number;
  readonly sem: number;
  readonly ciHalfWidth: number;
  readonly indeterminate: boolean;
}

export interface CandidateResult {
  readonly runId: string;
  readonly units: readonly UnitReplicates[];
  readonly counters: BudgetCounters;
}

export interface IncumbentResult {
  readonly units: readonly UnitReplicates[];
}

/** Per-unit comparison on a val unit: candidate vs incumbent point estimate. */
export interface UnitComparison {
  readonly unitId: string;
  readonly candidateMean: number;
  readonly incumbentMean: number;
  readonly ciHalfWidth: number;
  readonly delta: number; // candidateMean − incumbentMean
  readonly ciPasses: boolean; // ciHalfWidth ≤ stats.halfWidth
  readonly passes: boolean; // delta ≥ −ciHalfWidth (ties allowed)
}

export type Verdict = "nominated" | "culled" | "indeterminate" | "inconclusive";

export interface GateVerdict {
  readonly verdict: Verdict;
  readonly exitCode: ExitCode; // needsExit(verdict) — todo 9 consumes this mapping
  readonly runId: string;
  readonly counters: BudgetCounters; // surfaced even when inconclusive
  readonly caps: BudgetCaps;
  readonly gain: number | null; // null when the run was budget-truncated
  readonly minEffect: number;
  readonly effectiveAlpha: number; // FAMILY_ALPHA / nPairs
  readonly nPairs: number;
  readonly unitComparisons: readonly UnitComparison[];
  readonly failures: readonly string[];
}

export interface EvaluateInput {
  readonly candidate: CandidateResult;
  readonly incumbent: IncumbentResult;
  readonly stats: BenchStats;
  readonly budgetCaps: BudgetCaps;
  readonly nPairs: number; // simultaneous finalist pairs sharing the family alpha
}

export interface ParetoPoint {
  readonly id: string;
  readonly trainScore: number;
  readonly tokens: number;
  readonly wallS: number;
  readonly complete: boolean; // false ⇒ budget-truncated generation, never in the set
}

/** Family-wise alpha across finalist pairs (bonferroniAlpha divides it). */
export const FAMILY_ALPHA = 0.05;

/** Verdict → process exit code. inconclusive = 2 (cannot answer), never 0. */
export const VERDICT_EXIT: Readonly<Record<Verdict, ExitCode>> = {
  nominated: EXIT_OK, // 0 — gate recommends acceptance
  culled: EXIT_BLOCKED, // 1 — decision: rejected by the gates
  indeterminate: EXIT_BLOCKED, // 1 — decision: insufficient evidence to nominate
  inconclusive: EXIT_CANNOT_ANSWER, // 2 — budget truncated the run; cannot answer
};

export function needsExit(verdict: Verdict): ExitCode {
  return VERDICT_EXIT[verdict];
}

export function bonferroniAlpha(nPairs: number): number {
  if (!Number.isInteger(nPairs) || nPairs < 1) {
    throw new RangeError(`bonferroniAlpha: nPairs=${String(nPairs)} must be an integer >= 1`);
  }
  return FAMILY_ALPHA / nPairs;
}

// --- Student-t quantile (no deps: bisection on the regularized incomplete beta) ---

const BISECTION_ITERATIONS = 60;
const LANCZOS: readonly number[] = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

// Lanczos g=7 pairs with the 9 coefficients (c0..c8) above.
const LANCZOS_G = 7;

function logGamma(z: number): number {
  let x = z - 1;
  let acc = LANCZOS[0] as number;
  for (let i = 1; i < LANCZOS.length; i++) {
    acc += (LANCZOS[i] as number) / (x + i);
  }
  const t = x + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(acc);
}

/** Continued fraction for the regularized incomplete beta (Lentz, NR 6.4.2). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b), b=1/2 in every call here. */
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/**
 * Two-sided Student-t critical value: the t such that P(|T| ≤ t) = 1 − alpha
 * with T ~ t(df). Planned accuracy: matches t-table values to < 1e-3 for the
 * checked rows (stats.test.ts). alpha in (0,1), df ≥ 1.
 */
export function studentTQuantile(alpha: number, df: number): number {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`studentTQuantile: alpha=${String(alpha)} must be in (0, 1)`);
  if (!(df >= 1)) throw new RangeError(`studentTQuantile: df=${String(df)} must be >= 1`);
  // T ~ t(ν): P(T ≤ t) = 1 − ½·I_{ν/(ν+t²)}(ν/2, ½). For the two-sided critical
  // value I_{ν/(ν+t²)}(ν/2, ½) = alpha ⇒ t = √(ν(1−z)/z) with z = ν/(ν+t²).
  const a = df / 2;
  const b = 0.5;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (betai(a, b, mid) < alpha) lo = mid;
    else hi = mid;
  }
  const z = (lo + hi) / 2;
  return Math.sqrt((df * (1 - z)) / z);
}

/** Per-unit summary: mean, unbiased variance, 95% two-sided CI half-width. */
export function summarizeUnit(scores: readonly number[], alpha: number = FAMILY_ALPHA): UnitStat {
  const n = scores.length;
  if (n < 2) {
    return { n, mean: n === 1 ? (scores[0] as number) : Number.NaN, sampleVariance: Number.NaN, sem: Number.NaN, ciHalfWidth: Number.NaN, indeterminate: true };
  }
  let sum = 0;
  for (const s of scores) sum += s;
  const mean = sum / n;
  let ss = 0;
  for (const s of scores) {
    const d = s - mean;
    ss += d * d;
  }
  const sampleVariance = ss / (n - 1);
  const sem = Math.sqrt(sampleVariance / n);
  return { n, mean, sampleVariance, sem, ciHalfWidth: studentTQuantile(alpha, n - 1) * sem, indeterminate: false };
}

/** Aggregate bench score: mean over train unit means; val fallback when the bench has no train units. */
export function aggregateScore(units: readonly UnitReplicates[]): number {
  const train = units.filter((u) => u.split === "train");
  const pool = train.length > 0 ? train : units;
  let sum = 0;
  for (const u of pool) sum += summarizeUnit(u.scores).mean;
  return sum / pool.length;
}

/** `--reps N` clamps into [nReps.initial, nReps.max]; absent ⇒ initial (no sequential escalation in v1). */
export function clampReps(requested: number | undefined, nReps: BenchStats["nReps"]): number {
  const target = requested !== undefined && Number.isFinite(requested) ? requested : nReps.initial;
  return Math.min(nReps.max, Math.max(nReps.initial, target));
}

/** Any cap at/above ⇒ exhausted. Counters arrive as plain inputs — no I/O. */
export function budgetExhausted(counters: BudgetCounters, caps: BudgetCaps): boolean {
  return (
    counters.candidates >= caps.maxCandidates ||
    counters.modelCalls >= caps.maxModelCalls ||
    counters.tokens >= caps.maxTokens ||
    counters.wallS >= caps.maxWallS
  );
}

function fmt(x: number): string {
  return Number.isFinite(x) ? x.toFixed(4) : String(x);
}

function budgetFailureLines(counters: BudgetCounters, caps: BudgetCaps): readonly string[] {
  const rows: ReadonlyArray<[string, number, number]> = [
    ["candidates", counters.candidates, caps.maxCandidates],
    ["modelCalls", counters.modelCalls, caps.maxModelCalls],
    ["tokens", counters.tokens, caps.maxTokens],
    ["wallS", counters.wallS, caps.maxWallS],
  ];
  return rows
    .filter(([, used, cap]) => used >= cap)
    .map(([name, used, cap]) => `budget exhausted: ${name}=${used}/${cap}`);
}

/**
 * Nomination gate for ONE finalist pair (candidate vs incumbent). The verdict
 * never inspects the world: thresholds come from stats, budget counters and
 * caps are plain values, and the gate is RNG-free (no tie-break needed).
 */
export function evaluate(input: EvaluateInput): GateVerdict {
  const { candidate, incumbent, stats, budgetCaps, nPairs } = input;
  const alpha = bonferroniAlpha(nPairs);
  const base = {
    runId: candidate.runId,
    counters: candidate.counters,
    caps: budgetCaps,
    minEffect: stats.minEffect,
    effectiveAlpha: alpha,
    nPairs,
  };

  // 1) Budget exhaustion short-circuits: inconclusive, excluded from the
  //    comparison series, never an implicit pass even when metrics look great.
  if (budgetExhausted(candidate.counters, budgetCaps)) {
    return { ...base, verdict: "inconclusive", exitCode: needsExit("inconclusive"), gain: null, unitComparisons: [], failures: budgetFailureLines(candidate.counters, budgetCaps) };
  }

  const candByUnit = new Map(candidate.units.map((u) => [u.unitId, u]));
  const incByUnit = new Map(incumbent.units.map((u) => [u.unitId, u]));
  const failures: string[] = [];

  // 2) HARD RULE nReps ≥ 2: n<2 on ANY candidate unit (or a val unit missing
  //    from the candidate ⇒ n=0) leaves the variance undefined.
  for (const unit of candidate.units) {
    if (unit.scores.length < 2) {
      failures.push(`n=${unit.scores.length} on unit '${unit.unitId}': variance undefined — indeterminate, never nominated`);
    }
  }
  for (const [unitId, incUnit] of incByUnit) {
    if (incUnit.split === "val" && !candByUnit.has(unitId)) {
      failures.push(`no replicates for val unit '${unitId}' on candidate '${candidate.runId}' — variance undefined, never nominated`);
    }
  }
  if (failures.length > 0) {
    return { ...base, verdict: "indeterminate", exitCode: needsExit("indeterminate"), gain: aggregateScore(candidate.units) - aggregateScore(incumbent.units), unitComparisons: [], failures };
  }

  // 3) Per-val-unit comparisons + the two precision gates.
  const unitComparisons: UnitComparison[] = [];
  for (const [unitId, incUnit] of incByUnit) {
    if (incUnit.split !== "val") continue;
    const candUnit = candByUnit.get(unitId);
    if (candUnit === undefined) continue; // already ruled indeterminate above
    const cs = summarizeUnit(candUnit.scores, alpha);
    const incumbentMean = summarizeUnit(incUnit.scores).mean;
    const delta = cs.mean - incumbentMean;
    unitComparisons.push({
      unitId,
      candidateMean: cs.mean,
      incumbentMean,
      ciHalfWidth: cs.ciHalfWidth,
      delta,
      ciPasses: cs.ciHalfWidth <= stats.halfWidth,
      passes: delta >= -cs.ciHalfWidth, // ties allowed
    });
    if (cs.ciHalfWidth > stats.halfWidth) {
      failures.push(`CI half-width ${fmt(cs.ciHalfWidth)} > halfWidth ${fmt(stats.halfWidth)} on unit '${unitId}'`);
    }
    if (delta < -cs.ciHalfWidth) {
      failures.push(`regression on unit '${unitId}': delta ${fmt(delta)} < ${fmt(-cs.ciHalfWidth)} (mean ${fmt(cs.mean)} < ${fmt(incumbentMean)} - ${fmt(cs.ciHalfWidth)})`);
    }
  }

  // 4) Effect-size floor on the aggregate gain.
  const gain = aggregateScore(candidate.units) - aggregateScore(incumbent.units);
  if (gain < stats.minEffect) {
    failures.push(`gain ${fmt(gain)} < minEffect ${fmt(stats.minEffect)}`);
  }

  const verdict: Verdict = failures.length === 0 ? "nominated" : "culled";
  return { ...base, verdict, exitCode: needsExit(verdict), gain, unitComparisons, failures };
}

/** mulberry32 — dependency-free deterministic PRNG for tie-breaks. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dominates(q: ParetoPoint, p: ParetoPoint): boolean {
  return q.trainScore >= p.trainScore && q.tokens <= p.tokens && q.wallS <= p.wallS && (q.trainScore > p.trainScore || q.tokens < p.tokens || q.wallS < p.wallS);
}

/**
 * Non-dominated complete candidates, ranked for the human: trainScore desc,
 * then tokens asc, then wallS asc; exact ties share a seeded rank order
 * (same seed ⇒ same order). Budget-truncated generations never enter the set.
 */
export function paretoFrontier(points: readonly ParetoPoint[], seed: number = 1): readonly string[] {
  const complete = points.filter((p) => p.complete);
  const frontier = complete.filter((p) => !complete.some((q) => dominates(q, p)));
  frontier.sort((a, b) => {
    if (a.trainScore !== b.trainScore) return b.trainScore - a.trainScore;
    if (a.tokens !== b.tokens) return a.tokens - b.tokens;
    return a.wallS - b.wallS;
  });
  const rng = seededRandom(seed);
  const ids: string[] = [];
  let i = 0;
  while (i < frontier.length) {
    let j = i + 1;
    while (
      j < frontier.length &&
      frontier[j]!.trainScore === frontier[i]!.trainScore &&
      frontier[j]!.tokens === frontier[i]!.tokens &&
      frontier[j]!.wallS === frontier[i]!.wallS
    ) {
      j += 1;
    }
    const group = frontier.slice(i, j);
    // Fisher–Yates shuffle: deterministic per seed.
    for (let k = group.length - 1; k > 0; k--) {
      const r = Math.floor(rng() * (k + 1));
      [group[k], group[r]] = [group[r] as ParetoPoint, group[k] as ParetoPoint];
    }
    for (const p of group) ids.push(p.id);
    i = j;
  }
  return ids;
}