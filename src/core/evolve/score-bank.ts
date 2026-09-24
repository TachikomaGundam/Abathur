// Historical per-unit variance bank for the acceptance-semantics gate
// (engine redesign 2026-09-24; the design doc + power analysis live in the
// target genome repo's evidence folder, not shipped here).
//
// WHAT IT IS: for every unit, σ pooled from the within-group replicate scatter
// of ALL generation_complete rows in <genomeRepo>/.state/abathur/ledger*.jsonl
// (live ledger + campaign archives + pilot). A group = one bench event on one
// arm (one row's scores array for that unit), so its mean is that doc's mean:
// pooling mean-removed sums of squares across doc lineages is the classical
// ANOVA pooled within-group variance — champion-doc changes (the campaign-3
// promote at 7ca80d7 moved the incumbent head 6ca3ff68→556e1350→062a9fdb→
// 8fe7e34a→de607dab) shift group MEANS, never this estimate. Pooling raw
// scores/means across lineages would poison the bank and is what the per-group
// mean removal exists to prevent.
//
// SHIELDING: σ² = (df·σ̂² + ν₀·σ²_glob)/(df+ν₀) with ν₀ = BANK_PRIOR_DF = 2 —
// [0.5, 0.5] is two reps that failed to observe noise, not proof of σ=0. Thin
// history (df < BANK_THIN_DF) additionally floors σ at BANK_QUANTUM = 0.125/√2:
// unit scores are fractions of checklist items on a ~1/8 grid, so two reps one
// flipped item apart differ by exactly 0.125 and a one-step-pair has sd
// 0.125/√2; a unit quieter than that has only been lucky, not measured.
// Proven-quiet units (df ≥ BANK_THIN_DF, e.g. the guards with 12–14 zero-SS
// df) keep their tight shrunk σ — earned across independent benches.
//
// READ-ONLY AND FAIL-CLOSED: never Ledger.open (that mkdirs .state — the same
// discipline as peekPlanState in run-rows.ts), never writes, never exits the
// process. A row that fails schema validation contributes nothing and only
// adds a notice (archives may legitimately predate schema evolutions). No
// files / no readable rows / zero pooled df ⇒ null ⇒ the caller must run the
// legacy cross-arm gate verbatim: the bank can only inform, absence can never
// invent a nomination or a cull.
//
// ACTIVATION REQUIRES A ROTATED ARCHIVE: with only the live ledger.jsonl
// present the bank stays null. A lone live file may be one campaign young
// (gate-time df=1 per unit — zero cross-doc information) or, worse, the fresh
// .state of any toy/fixture genome whose very first run would silently switch
// gates mid-test. Rotation (ledger.campaign<N>-*.jsonl) is the operator's own
// mark that a genome has earned lifetime history, so it is also the mark that
// entitles the acceptance gate to override the proven legacy default.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { LEDGER_KIND_GENERATION_COMPLETE, ledgerPath, ledgerRecordSchema } from "../ledger.js";
import { generationRowDataSchema } from "./run-rows.js";
import type { UnitBankStat } from "../stats.js";

// ------------------------------------------------------------- bank epoch
// Lineage-restart quarantine (institutional addition 2026-09-25, born of the
// s19 pin era + the s16 churn window): an operator-ruled epoch start for a
// unit voids every bank group whose row.ts predates it — a broken or polluted
// measurement era must not teach the gate the wrong noise level. The LEDGER
// FILES STAY IMMUTABLE (doctrine): the verdict on which rows count lives in
// this sidecar, beside its prose provenance (rotation NOTEs / evidence pages).
// FAIL-CLOSED IN BOTH DIRECTIONS: absent sidecar ⇒ no quarantine; present but
// malformed/unreadable/unparsable-dates ⇒ the WHOLE bank returns null and the
// caller runs the legacy gate verbatim — a quarantine we cannot read honestly
// is a quarantine we cannot silently ignore.

const BANK_EPOCH_FILE = "bank-epoch.json";

const bankEpochSchema = z.record(
  z.string().min(1),
  z
    .object({ sinceIso: z.string().min(1), why: z.string().optional() })
    .strict(),
);

type BankEpoch = ReadonlyMap<string, { readonly sinceMs: number; readonly why: string }>;

function loadBankEpoch(dir: string, note: (line: string) => void): BankEpoch | null | undefined {
  let raw: string;
  try {
    raw = readFileSync(path.join(dir, BANK_EPOCH_FILE), "utf8");
  } catch (cause) {
    const code = (cause as { code?: string } | null)?.code;
    if (code === "ENOENT") return undefined; // absent: nothing quarantined
    note(`${BANK_EPOCH_FILE}: unreadable (${String(cause)}) — bank disabled, legacy gate`);
    return null;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (cause) {
    note(`${BANK_EPOCH_FILE}: invalid JSON (${String(cause)}) — bank disabled, legacy gate`);
    return null;
  }
  const parsed = bankEpochSchema.safeParse(doc);
  if (!parsed.success) {
    note(`${BANK_EPOCH_FILE}: schema violation (${parsed.error.issues[0]?.message ?? "?"}) — bank disabled, legacy gate`);
    return null;
  }
  const out = new Map<string, { sinceMs: number; why: string }>();
  for (const [unitId, rule] of Object.entries(parsed.data)) {
    const sinceMs = Date.parse(rule.sinceIso);
    if (!Number.isFinite(sinceMs)) {
      note(`${BANK_EPOCH_FILE}: bad sinceIso for '${unitId}' — bank disabled, legacy gate`);
      return null;
    }
    out.set(unitId, { sinceMs, why: rule.why ?? "" });
  }
  return out;
}

/** Half of one 1/8-grid checklist step between two reps — the sd of that pair. */
export const BANK_QUANTUM = 0.125 / Math.SQRT2;
/** Phantom df of the bank-wide pooled prior used to shrink each unit's σ̂². */
export const BANK_PRIOR_DF = 2;
/** Below this pooled df a unit's history counts as thin and the quantum floor binds. */
export const BANK_THIN_DF = 6;
/** Notices stop accumulating past this many lines (a corrupt archive must not flood run output). */
const NOTICE_CAP = 20;

export interface ScoreBank {
  /** unitId → pooled historical noise; only units with df ≥ 1 are priced. */
  readonly units: ReadonlyMap<string, UnitBankStat>;
  /** √(Σ SS_within / Σ df) over every group — the shrinkage prior. */
  readonly priorSigma: number;
  readonly totalDf: number;
  readonly notices: readonly string[];
}

interface Accumulator {
  df: number;
  ss: number;
}

/** One group = one row × unit; a multi-rep scores array contributes n−1 df of within-mean scatter. */
function accumulate(acc: Map<string, Accumulator>, unitId: string, scores: readonly number[]): void {
  const n = scores.length;
  if (n < 2) return;
  let sum = 0;
  for (const s of scores) sum += s;
  const mean = sum / n;
  let ss = 0;
  for (const s of scores) {
    const d = s - mean;
    ss += d * d;
  }
  const cur = acc.get(unitId) ?? { df: 0, ss: 0 };
  acc.set(unitId, { df: cur.df + (n - 1), ss: cur.ss + ss });
}

export interface ScoreBankOptions {
  /** Gate-time replay hook: treat these candidate treeShas' rows as not yet written. */
  readonly excludeCandidateTrees?: readonly string[] | undefined;
  /** Gate-time replay hook: pretend these ledger file names (e.g. a future campaign's archive) do not exist. */
  readonly excludeFiles?: readonly string[] | undefined;
}

const LIVE_LEDGER = "ledger.jsonl";

function isRotatedArchive(name: string): boolean {
  return name.startsWith("ledger.") && name.endsWith(".jsonl") && name !== LIVE_LEDGER && !name.startsWith("ledger.corrupt-");
}

export function loadScoreBank(genomeRepo: string, opts: ScoreBankOptions = {}): ScoreBank | null {
  const dir = path.dirname(ledgerPath(genomeRepo));
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null; // no .state/abathur at all — fresh genome, legacy gate
  }
  const excluded = new Set(opts.excludeCandidateTrees ?? []);
  const excludedFiles = new Set(opts.excludeFiles ?? []);
  const files = names.filter((n) => (n === LIVE_LEDGER || isRotatedArchive(n)) && !excludedFiles.has(n)).sort();
  if (!files.some(isRotatedArchive)) return null; // activation law: rotated history or legacy gate

  const notices: string[] = [];
  const note = (line: string): void => {
    if (notices.length < NOTICE_CAP) notices.push(line);
    else if (notices.length === NOTICE_CAP) notices.push("score bank: further notices suppressed");
  };

  const bankEpoch = loadBankEpoch(dir, note);
  if (bankEpoch === null) return null; // malformed quarantine ⇒ legacy gate, never a silently ignored one
  const quarantined = new Map<string, number>();

  const acc = new Map<string, Accumulator>();
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(path.join(dir, file), "utf8");
    } catch {
      note(`${file}: unreadable — archive skipped`);
      continue;
    }
    const lines = text.split("\n");
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (line.length === 0) return;
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        note(`${file}:${String(index + 1)}: not JSON — row skipped`);
        return;
      }
      const parsed = ledgerRecordSchema.safeParse(record);
      if (!parsed.success || parsed.data.kind !== LEDGER_KIND_GENERATION_COMPLETE) return;
      const row = generationRowDataSchema.safeParse(parsed.data.data);
      if (!row.success) {
        note(`${file}:${String(index + 1)}: generation_complete row unreadable — row skipped`);
        return;
      }
      if (row.data.source === "candidate" && row.data.treeSha !== undefined && excluded.has(row.data.treeSha)) return;
      const rowMs = Date.parse(parsed.data.ts);
      for (const u of row.data.units) {
        const rule = bankEpoch?.get(u.unitId);
        if (rule !== undefined && !(Number.isFinite(rowMs) && rowMs >= rule.sinceMs)) {
          quarantined.set(u.unitId, (quarantined.get(u.unitId) ?? 0) + 1);
          continue; // only rows provably at/after the epoch start count; unreadable ts fails closed
        }
        accumulate(acc, u.unitId, u.scores);
      }
    });
  }
  for (const [unitId, rule] of [...(bankEpoch ?? new Map()).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    note(`bank-epoch '${unitId}' since ${rule.sinceIso}: ${String(quarantined.get(unitId) ?? 0)} group(s) quarantined${rule.why === "" ? "" : ` — ${rule.why}`}`);
  }

  let totalDf = 0;
  let totalSs = 0;
  for (const { df, ss } of acc.values()) {
    totalDf += df;
    totalSs += ss;
  }
  if (totalDf === 0) return null;
  const priorVar = totalSs / totalDf;

  const units = new Map<string, UnitBankStat>();
  for (const [unitId, { df, ss }] of [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const within = ss / df;
    const shrunk = (df * within + BANK_PRIOR_DF * priorVar) / (df + BANK_PRIOR_DF);
    const sigma = Math.sqrt(shrunk);
    units.set(unitId, { sigma: df >= BANK_THIN_DF ? sigma : Math.max(sigma, BANK_QUANTUM), df });
  }
  return { units, priorSigma: Math.sqrt(priorVar), totalDf, notices };
}
