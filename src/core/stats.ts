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
// ACCEPTANCE SEMANTICS (2026-09-24 redesign; design doc lives in the target
// genome repo's evidence folder, not shipped here): when EvaluateInput.bank
// carries the historical per-unit variance bank, precision/regression checks
// price NOISE
// with bank σ instead of per-arm t(df=n−1) CIs (the campaign-9/10 resolution
// floor: t(0.05,1)=12.706 turned a 2-point sample into a 1.5883 half-width).
// A val unit with bank σ clears when P(Δ ≤ −halfWidth) < q_pair AND the
// acceptance band Z(q)·σ/√n_candidate ≤ halfWidth; the aggregate additionally
// requires P(gain shift > 0) = Φ(gain/SE) ≥ q_pair, q_pair = 1−(1−ACCEPT_Q)/nPairs.
// EVERY fail-closed rule ABOVE the bank path is untouched and can never be
// bypassed by it: budget⇒inconclusive, one-sided n<2⇒indeterminate,
// both-unmeasured⇒symmetric exclusion. A unit the bank cannot price falls back
// to the exact legacy t-CI line; a null/absent bank reproduces the pre-2026-09-24
// gate verbatim. minEffect 0.1 / halfWidth 0.15 point semantics stand.
//
// The inverse Student-t lives in stats-math.ts and the Pareto ranking in
// stats-pareto.ts; both are re-exported here so the public surface of this
// module — the one todos 9/10/12 consume — is unchanged. Accuracy: |t − table|
// < 1e-3 for the t-distribution rows checked in stats.test.ts (df=1..30, α=0.05).

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
import { studentTQuantile, normalCdf, normalQuantile } from "./stats-math.js";
import { seededRandom, paretoFrontier } from "./stats-pareto.js";
export { studentTQuantile, normalCdf, normalQuantile, seededRandom, paretoFrontier };
export type { ParetoPoint } from "./stats-pareto.js";

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

/**
 * One unit's historical per-replicate noise from the score bank: σ pooled
 * within bench groups across the whole lineage (mean-removed ⇒ doc changes
 * shift group means, never the pooled variance) and ν₀=2-shrunk toward the
 * bank-wide prior. df counts the pooled within-group degrees of freedom.
 */
export interface UnitBankStat {
  readonly sigma: number;
  readonly df: number;
}

/** Nomination acceptance probability (per finalist pair after Bonferroni). */
export const ACCEPT_Q = 0.9;

/** q_pair = 1 − (1 − ACCEPT_Q)/nPairs — Bonferroni on the acceptance ERROR rate. */
export function bonferroniQ(nPairs: number): number {
  if (!Number.isInteger(nPairs) || nPairs < 1) {
    throw new RangeError(`bonferroniQ: nPairs=${String(nPairs)} must be an integer >= 1`);
  }
  return Math.min(0.9999, 1 - (1 - ACCEPT_Q) / nPairs);
}

/** Per-val-unit acceptance diagnostics (only for units the bank could price). */
export interface AcceptanceUnitReport {
  readonly unitId: string;
  readonly sigma: number;
  readonly df: number;
  readonly delta: number;
  readonly se: number;
  /** Acceptance band Z(q)·σ/√n_candidate replacing the legacy t-CI half-width. */
  readonly band: number;
  /** P(Δ ≤ −halfWidth) — the guard regression veto probability. */
  readonly pRegression: number;
}

/** Surface of the acceptance path: exact numbers behind the verdict. */
export interface AcceptanceReport {
  readonly q: number; // q_pair actually applied
  readonly gainSe: number | null; // null ⇒ a train-pool unit lacks bank σ ⇒ legacy point-gain gate
  readonly pShift: number | null; // P(gain shift > 0)
  readonly units: readonly AcceptanceUnitReport[];
}

/** Per-unit comparison on a val unit: candidate vs incumbent point estimate. */
export interface UnitComparison {
  readonly unitId: string;
  readonly candidateMean: number;
  readonly incumbentMean: number;
  readonly ciHalfWidth: number; // legacy: t-CI half-width; banked: acceptance band Z(q)·σ/√n_c
  readonly delta: number; // candidateMean − incumbentMean
  readonly ciPasses: boolean; // ciHalfWidth ≤ stats.halfWidth
  readonly passes: boolean; // legacy: delta ≥ −ciHalfWidth (ties allowed); banked: P(Δ ≤ −halfWidth) < q_pair
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
  /** Present iff a score bank was supplied — the exact acceptance numbers behind the verdict. */
  readonly acceptance?: AcceptanceReport;
}

export interface EvaluateInput {
  readonly candidate: CandidateResult;
  readonly incumbent: IncumbentResult;
  readonly stats: BenchStats;
  readonly budgetCaps: BudgetCaps;
  readonly nPairs: number; // simultaneous finalist pairs sharing the family alpha
  /**
   * Historical variance bank (unit → σ, df); null/absent ⇒ the legacy
   * per-arm t-CI gate runs verbatim. Loaded once per campaign from the
   * genome's ledger + archives by score-bank.ts; the gate itself stays I/O-free.
   */
  readonly bank?: ReadonlyMap<string, UnitBankStat> | null;
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

  // 2) Cross-arm replicate rule. A unit measured cleanly (n>=2) on ONE arm but
  //    not on the other leaves that comparison's variance undefined ⇒
  //    indeterminate, never a silent cull and never a nomination (campaign-6:
  //    the candidate's train unit scored while the incumbent's had timed out;
  //    the old one-sided drop shifted the incumbent aggregate to the val
  //    fallback and minted a bogus negative gain). A unit unmeasured on BOTH
  //    arms is excluded symmetrically — every aggregate and comparison then
  //    runs on a pool both arms share replicate-for-replicate.
  const excluded = new Set<string>();
  for (const unitId of new Set([...incByUnit.keys(), ...candByUnit.keys()])) {
    const cn = candByUnit.get(unitId)?.scores.length ?? 0;
    const inn = incByUnit.get(unitId)?.scores.length ?? 0;
    if (cn >= 2 && inn < 2) {
      failures.push(`n=${inn} on incumbent unit '${unitId}': baseline variance undefined — indeterminate, never nominated`);
    } else if (inn >= 2 && cn < 2) {
      if (incByUnit.get(unitId)?.split === "val") {
        failures.push(`no replicates for val unit '${unitId}' on candidate '${candidate.runId}' — variance undefined, never nominated`);
      } else {
        failures.push(`n=${cn} on unit '${unitId}': variance undefined — indeterminate, never nominated`);
      }
    } else if (cn < 2 && inn < 2) {
      excluded.add(unitId);
    }
  }
  if (failures.length > 0) {
    return { ...base, verdict: "indeterminate", exitCode: needsExit("indeterminate"), gain: null, unitComparisons: [], failures };
  }
  const candKept = candidate.units.filter((u) => !excluded.has(u.unitId));
  const incKept = incumbent.units.filter((u) => !excluded.has(u.unitId));
  // Vacuous-evidence guard (r21 postmortem): every unit symmetrically excluded
  // (both arms n<2 — infra death or missing replicates) leaves an empty pool;
  // downstream means of empty arrays are NaN, and a NaN gain must never reach
  // a nomination. This is a bench-health event, not a candidate verdict.
  if (candKept.length === 0 && incKept.length === 0) {
    return { ...base, verdict: "inconclusive", exitCode: needsExit("inconclusive"), gain: null, unitComparisons: [], failures: ["no unit comparable on both arms (all excluded: infrastructure failures or missing replicates) — vacuous evidence, never nominated"] };
  }
  const candByUnitKept = new Map(candKept.map((u) => [u.unitId, u]));

  // 3) Per-val-unit comparisons + the two precision gates. With a bank that
  //    knows the unit, acceptance semantics (see module header) replace the
  //    per-arm t-CI machinery FOR THAT UNIT ONLY; bank-unknown units keep the
  //    legacy lines verbatim. The fail-closed rules above run before and
  //    independently of any bank.
  const bank = input.bank ?? null;
  const qPair = bonferroniQ(nPairs);
  const acceptanceUnits: AcceptanceUnitReport[] = [];
  const unitComparisons: UnitComparison[] = [];
  for (const [unitId, incUnit] of incByUnit) {
    if (incUnit.split !== "val" || excluded.has(unitId)) continue;
    const candUnit = candByUnitKept.get(unitId);
    if (candUnit === undefined) continue; // excluded/unreachable
    const incumbentMean = summarizeUnit(incUnit.scores).mean;
    const cs = summarizeUnit(candUnit.scores, alpha);
    const delta = cs.mean - incumbentMean;
    const banked = bank?.get(unitId) ?? null;
    if (banked === null) {
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
      continue;
    }
    const se = banked.sigma * Math.sqrt(1 / candUnit.scores.length + 1 / incUnit.scores.length);
    const band = (normalQuantile(qPair) * banked.sigma) / Math.sqrt(candUnit.scores.length);
    const pRegression = se === 0 ? (delta <= -stats.halfWidth ? 1 : 0) : normalCdf((-stats.halfWidth - delta) / se);
    const ciPasses = band <= stats.halfWidth;
    const passes = pRegression < qPair; // ties at −halfWidth sit at Φ(0)=0.5 < q ⇒ still pass
    unitComparisons.push({ unitId, candidateMean: cs.mean, incumbentMean, ciHalfWidth: band, delta, ciPasses, passes });
    acceptanceUnits.push({ unitId, sigma: banked.sigma, df: banked.df, delta, se, band, pRegression });
    if (!ciPasses) {
      failures.push(`acceptance band ${fmt(band)} > halfWidth ${fmt(stats.halfWidth)} on unit '${unitId}' (bank sigma ${fmt(banked.sigma)}, df ${String(banked.df)})`);
    } else if (!passes) {
      failures.push(`regression on unit '${unitId}': delta ${fmt(delta)} — P(Δ ≤ −${fmt(stats.halfWidth)}) = ${fmt(pRegression)} ≥ q ${fmt(qPair)} (bank sigma ${fmt(banked.sigma)})`);
    }
  }

  // 4) Effect-size floor on the aggregate gain (shared, symmetric pool) —
  //    unchanged — plus the acceptance gate: when the bank can price EVERY
  //    unit of the gain pool, nomination additionally requires P(Δ>0) ≥ q.
  //    A bank-priced point mass exactly at 0 (se=0, gain=0) fails (pShift=0):
  //    demonstrated-identical arms are never nominated on a tie.
  const gain = aggregateScore(candKept) - aggregateScore(incKept);
  if (gain < stats.minEffect) {
    failures.push(`gain ${fmt(gain)} < minEffect ${fmt(stats.minEffect)}`);
  }
  let gainSe: number | null = null;
  let pShift: number | null = null;
  if (bank !== null) {
    const train = candKept.filter((u) => u.split === "train");
    const pool = train.length > 0 ? train : candKept;
    const incCounts = new Map(incKept.map((u) => [u.unitId, u.scores.length]));
    const priced = pool.map((u) => bank.get(u.unitId) ?? null);
    if (priced.every((s): s is UnitBankStat => s !== null)) {
      const k = pool.length;
      let variance = 0;
      pool.forEach((u, index) => {
        const s = priced[index] as UnitBankStat;
        variance += ((s.sigma * s.sigma) * (1 / u.scores.length + 1 / (incCounts.get(u.unitId) ?? 0))) / (k * k);
      });
      gainSe = Math.sqrt(variance);
      pShift = gainSe === 0 ? (gain > 0 ? 1 : 0) : normalCdf(gain / gainSe);
      if (pShift < qPair) {
        failures.push(`acceptance: P(gain shift > 0) = ${fmt(pShift)} < q ${fmt(qPair)} (se ${fmt(gainSe)}, gain ${fmt(gain)})`);
      }
    }
  }

  const verdict: Verdict = failures.length === 0 ? "nominated" : "culled";
  const acceptance: AcceptanceReport | undefined = bank === null ? undefined : { q: qPair, gainSe, pShift, units: acceptanceUnits };
  return { ...base, verdict, exitCode: needsExit(verdict), gain, unitComparisons, failures, ...(acceptance === undefined ? {} : { acceptance }) };
}

