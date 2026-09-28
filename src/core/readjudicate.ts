// re-adjudicate (institutional addition 2026-09-28, born of the c17 silent-downgrade
// incident): when the GATE code that judged a generation is later found to have been
// the wrong binary (or any honest cause), the corrected verdict must be able to enter
// machine state WITHOUT touching the immutable ledger files: this command replays the
// CURRENT evaluate() over the archived rows and APPENDS a fresh generation_complete
// row carrying the corrected verdict plus full provenance. Promote already reads the
// LAST row for a gen, so a corrected nomination unlocks the human gate; a corrected
// cull stays honest too — this tool re-judges, it never flips.
//
// Replay contract (mirrors scripts/backtest-acceptance.mjs, the established approach):
//  - gate-time counters = lifetime sum over the epoch (all rows sharing the runId)
//    MINUS the candidate row's own spend (its slot was already committed by the
//    session clamp — feeding it back would self-trip the cap, run-loop.ts:316-318);
//  - the score bank excludes THIS candidate's own tree groups (its verdict-time
//    draws must not price its own noise — excludeCandidateTrees is the built hook);
//  - nPairs = 1 (one finalist pair per re-judged epoch).
// Fail-closed: no candidate row / no incumbent row for the same runId / an existing
// promote row for the gen ⇒ refusal before any state read becomes a mutation.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { blocked, cannotAnswer } from "../exit.js";
import type { RegistryEntry } from "./genome.js";
import { effectiveRepoPath } from "./spec.js";
import { evaluate, needsExit, type BudgetCounters, type Verdict } from "./stats.js";
import { acquireGenomeLock, acquireLock, Ledger, ledgerPath, ledgerRecordSchema, LEDGER_KIND_GENERATION_COMPLETE, LEDGER_KIND_PROMOTE, type LedgerRecord } from "./ledger.js";
import { asReplicates, decodeGenerationRecord } from "./evolve/run-bench.js";
import { effectiveCaps } from "./evolve/run-plan.js";
import type { GenerationRowData } from "./evolve/run-rows.js";
import { loadScoreBank } from "./evolve/score-bank.js";

const LIVE_LEDGER = "ledger.jsonl";

function isRotatedArchive(name: string): boolean {
  return name.startsWith("ledger.") && name.endsWith(".jsonl") && name !== LIVE_LEDGER && !name.startsWith("ledger.corrupt-");
}

interface FileRow {
  readonly file: string;
  readonly ts: string;
  readonly record: LedgerRecord;
}

/** Same read discipline as the score bank: schema-invalid lines are skipped with a notice, never a crash. */
function collectRows(dir: string): { rows: FileRow[]; notices: string[] } {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { rows: [], notices: [] };
  }
  const files = names.filter((n) => n === LIVE_LEDGER || isRotatedArchive(n)).sort();
  const rows: FileRow[] = [];
  const notices: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(path.join(dir, file), "utf8");
    } catch {
      notices.push(`${file}: unreadable — skipped`);
      continue;
    }
    for (const [index, raw] of text.split("\n").entries()) {
      const line = raw.trim();
      if (line.length === 0) continue;
      let candidate: unknown;
      try {
        candidate = JSON.parse(line);
      } catch {
        notices.push(`${file}:${String(index + 1)}: not JSON — row skipped`);
        continue;
      }
      const parsed = ledgerRecordSchema.safeParse(candidate);
      if (!parsed.success) {
        notices.push(`${file}:${String(index + 1)}: schema-invalid — row skipped`);
        continue;
      }
      rows.push({ file, ts: parsed.data.ts, record: parsed.data });
    }
  }
  return { rows, notices };
}

function display(value: string, max = 96): string {
  const flat = value.replace(/[^ -~]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export interface ReadjudicateRequest {
  readonly entry: RegistryEntry;
  readonly configDir: string;
  readonly genId: string;
  readonly now: () => Date;
}

export interface ReadjudicateOutcome {
  readonly appended: boolean;
  readonly verdict: string;
  readonly lines: readonly string[];
}

export function readjudicateGeneration(req: ReadjudicateRequest): ReadjudicateOutcome {
  const { entry, genId } = req;
  const shown = display(genId);
  const repo = effectiveRepoPath(entry.spec.repoPath);
  const dir = path.dirname(ledgerPath(repo));
  const { rows, notices } = collectRows(dir);

  // locate the candidate row: the LAST generation_complete row for this gen that is a
  // candidate arm; if it already carries readjudication provenance, this is the second pass.
  const genRows = rows.filter((r) => r.record.kind === LEDGER_KIND_GENERATION_COMPLETE && r.record.genId === genId);
  let incumbent: { row: FileRow; data: GenerationRowData } | null = null;
  let candidate: { row: FileRow; data: GenerationRowData } | null = null;
  for (const r of genRows) {
    let data: GenerationRowData;
    try {
      data = decodeGenerationRecord(r.record);
    } catch {
      continue; // not a decodable generation row — skip like the bank does
    }
    if (data.source === "candidate") candidate = { row: r, data };
  }
  if (candidate === null) {
    blocked(`re-adjudicate: no candidate generation_complete row for gen '${shown}' (searched live ledger + rotated archives in ${dir})`, `state is read only from the ledger files — check candidates with \`abathur status ${entry.label}\``);
  }
  if (candidate.data.verdict === undefined) {
    blocked(`re-adjudicate: candidate row for gen '${shown}' has no verdict — nothing to re-judge`);
  }
  // non-null alias: TS narrowing does not survive let-assignment inside loops
  const cand = candidate;
  if (rows.some((r) => r.record.kind === LEDGER_KIND_PROMOTE && r.record.genId === genId)) {
    blocked(`re-adjudicate: gen '${shown}' is already promoted — a corrected verdict cannot and need not move it`);
  }

  // incumbent row: same runId, candidate's epoch — search ALL rows, archives included.
  const runId = cand.row.record.runId;
  if (runId === undefined) cannotAnswer(`re-adjudicate: candidate row for gen '${shown}' lacks runId — cannot pair it with its incumbent baseline`);
  for (const r of rows) {
    if (r.record.kind !== LEDGER_KIND_GENERATION_COMPLETE || r.record.runId !== runId) continue;
    if (r.record.genId === genId) continue; // same gen never supplies the incumbent arm
    let data: GenerationRowData;
    try {
      data = decodeGenerationRecord(r.record);
    } catch {
      continue;
    }
    if (data.source === "incumbent") {
      if (incumbent !== null && incumbent.row.record.genId !== r.record.genId) {
        cannotAnswer(`re-adjudicate: multiple incumbent rows for runId '${display(runId)}' with differing gens — ambiguous epoch, refusing`);
      }
      incumbent = { row: r, data };
    }
  }
  if (incumbent === null) {
    blocked(`re-adjudicate: no incumbent baseline row for runId '${display(runId)}' (candidate gen '${shown}') — cannot re-judge an unpaired epoch`);
  }
  const inc = incumbent; // non-null alias (incumbent guarded above; narrowing dies in the loop)

  // gate-time counters mirror the backtest: lifetime epoch sum minus the candidate's own slot.
  let tokens = 0;
  let modelCalls = 0;
  let wallS = 0;
  for (const r of rows) {
    if (r.record.runId !== runId) continue;
    if (r === cand.row) continue;
    let data: GenerationRowData;
    try {
      data = decodeGenerationRecord(r.record);
    } catch {
      continue;
    }
    tokens += data.counters.tokens;
    modelCalls += data.counters.modelCalls;
    wallS += data.counters.wallS;
  }
  const counters: BudgetCounters = { candidates: 0, modelCalls, tokens, wallS: Number(wallS.toFixed(3)) };

  const bank = loadScoreBank(repo, { excludeCandidateTrees: cand.data.treeSha === undefined ? [] : [cand.data.treeSha] });
  const gate = evaluateWith(entry, cand.data, inc.data, counters, runId, bank);

  const lines: string[] = [];
  for (const n of notices) lines.push(`notice: ${n}`);
  lines.push(
    `replay: gen ${shown} verdict-time ${gate.candidateVerdictBefore} -> current gate '${gate.verdict}' (gain ${gate.gain === null ? "null" : gate.gain.toFixed(4)}, bank ${bank === null ? "absent → legacy gate" : `${String(bank.units.size)} units, prior sigma ${bank.priorSigma.toFixed(4)}, pooled df ${String(bank.totalDf)}`})`,
  );
  if (gate.verdict === cand.data.verdict && cand.data.readjudication === undefined) {
    lines.push(`no-op: current gate already agrees with the row verdict '${gate.verdict}' — nothing appended`);
    return { appended: false, verdict: gate.verdict, lines };
  }
  if (cand.data.readjudication !== undefined && gate.verdict === cand.data.verdict) {
    lines.push(`no-op: gen already carries a readjudication row with verdict '${gate.verdict}' — nothing appended`);
    return { appended: false, verdict: gate.verdict, lines };
  }

  const ledger = Ledger.open(repo);
  const lease = acquireGenomeLock({ ledger, configDir: req.configDir, genomeFp: entry.fingerprint });
  try {
    const repoLease = acquireLock({ configDir: path.join(repo, ".state", "abathur"), key: "gate", label: "re-adjudicate lock" });
    try {
      // re-read under lock: a promote or younger row may have landed while we computed.
      const fresh = collectRows(dir).rows.filter((r) => r.record.kind === LEDGER_KIND_GENERATION_COMPLETE && r.record.genId === genId);
      const lastData = [...fresh].reverse().map((r) => {
        try {
          return decodeGenerationRecord(r.record);
        } catch {
          return null;
        }
      }).find((d) => d !== null);
      if (lastData === undefined) {
        blocked(`re-adjudicate: gen '${shown}' rows vanished under lock — state moved, nothing appended`);
      }
      if (lastData.verdict === gate.verdict) {
        lines.push(`no-op (under lock): last row already reads '${gate.verdict}'`);
        return { appended: false, verdict: gate.verdict, lines };
      }
      if (lastData.readjudication !== undefined) {
        blocked(`re-adjudicate: gen '${shown}' already has a readjudication row verdict '${lastData.verdict}' disagreeing with replay '${gate.verdict}' — a second correction would erase the first; hand the ledger a ruling instead`);
      }
      if (fresh.some((r) => r.record.kind === LEDGER_KIND_PROMOTE)) {
        blocked(`re-adjudicate: gen '${shown}' was promoted while this command computed — refusing to amend a promoted epoch`);
      }
      const replayExit = needsExit(gate.verdict);
      const data: GenerationRowData = {
        ...cand.data,
        verdict: gate.verdict,
        exitCode: replayExit === 0 ? 0 : replayExit === 1 ? 1 : 2,
        gain: gate.gain,
        gateFailures: [...gate.failures],
        readjudication: {
          at: req.now().toISOString(),
          specFingerprint: entry.fingerprint,
          gate: bank === null ? "legacy" : "acceptance",
          bank: bank === null ? null : { units: bank.units.size, priorSigma: bank.priorSigma, pooledDf: bank.totalDf },
          sourceRows: {
            candidate: { file: cand.row.file, ts: cand.row.ts },
            incumbent: { file: inc.row.file, ts: inc.row.ts },
          },
          replacedVerdict: cand.data.verdict ?? "none",
        },
      };
      ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId, ...(runId === undefined ? {} : { runId }), data });
      lines.push(`ledger: appended corrected generation_complete row (verdict '${gate.verdict}', actor: re-adjudicate) to ${ledgerPath(repo)}`);
      lines.push(`files are immutable — the original '${cand.data.verdict}' row remains in ${cand.row.file} as history`);
      for (const f of gate.failures) lines.push(`  gate: ${f}`);
    } finally {
      repoLease.release();
    }
  } finally {
    lease.release();
  }
  return { appended: true, verdict: gate.verdict, lines };
}

// the replay itself — kept tiny and explicit so the counters/bank/nPairs contract above is auditable.
function evaluateWith(
  entry: RegistryEntry,
  candidate: GenerationRowData,
  incumbent: GenerationRowData,
  counters: BudgetCounters,
  runId: string | undefined,
  bank: ReturnType<typeof loadScoreBank>,
): { verdict: Verdict; gain: number | null; failures: readonly string[]; candidateVerdictBefore: string } {
  const verdict = evaluate({
    candidate: { runId: runId ?? "re-adjudicate", units: asReplicates(candidate.units), counters },
    incumbent: { units: asReplicates(incumbent.units) },
    stats: entry.spec.bench.stats,
    budgetCaps: effectiveCaps(entry.spec, undefined),
    nPairs: 1,
    ...(bank === null ? {} : { bank: bank.units }),
  });
  return { verdict: verdict.verdict, gain: verdict.gain, failures: verdict.failures, candidateVerdictBefore: String(candidate.verdict) };
}
