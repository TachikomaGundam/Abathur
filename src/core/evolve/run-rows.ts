// Generation-row persistence for the run-loop (todo 9): the zod shape of
// `kind === "generation_complete"` ledger data + resume readers. The ledger
// format itself belongs to todo 2 and is UNCHANGED.
//
// Row accounting rules (exactly-once resume):
//   - counters on a row are THAT ROW's spend; the run's cumulative budget state is
//     the sum over all generation rows, so a resume never double-counts and a
//     crashed candidate whose row never committed re-benches with fresh samples;
//   - candidates are deduplicated by content tree sha (stable across reseals,
//     unlike commit shas), the incumbent by headCommit + source;
//   - budget-truncated benches persist partial evidence (complete:false) — spend
//     already incurred must stay booked or a resume could re-spend it.

import { readFileSync } from "node:fs";

import { z } from "zod";

import { cannotAnswer } from "../../exit.js";
import { LEDGER_KIND_GENERATION_COMPLETE, Ledger, ledgerPath, ledgerRecordSchema, type LedgerRecord } from "../ledger.js";
import type { BudgetCounters } from "../stats.js";

export const unitMatrixRowSchema = z.strictObject({
  unitId: z.string().min(1),
  split: z.enum(["train", "val"]),
  scores: z.array(z.number()),
  runIds: z.array(z.string()),
  failures: z.array(z.string()),
});
export type UnitMatrixRow = z.infer<typeof unitMatrixRowSchema>;

const countersSchema = z.strictObject({
  candidates: z.number(),
  modelCalls: z.number(),
  tokens: z.number(),
  wallS: z.number(),
});

export const VERDICTS = ["nominated", "culled", "indeterminate", "inconclusive"] as const;

export const generationRowDataSchema = z
  .strictObject({
    source: z.enum(["candidate", "incumbent"]),
    candidateId: z.string().min(1).optional(),
    rationale: z.string().optional(),
    /** Incumbent HEAD this generation was forked from (resume identity for incumbent rows). */
    headCommit: z.string().min(1),
    commitSha: z.string().optional(),
    /** Content tree sha — the stable dedup key for candidate generations. */
    treeSha: z.string().optional(),
    complete: z.boolean(),
    reps: z.number().int().positive(),
    units: z.array(unitMatrixRowSchema),
    counters: countersSchema,
    manifest: z.array(z.strictObject({ glob: z.string(), path: z.string(), sha256: z.string() })),
    verdict: z.enum(VERDICTS).optional(),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    gain: z.number().nullable().optional(),
    gateFailures: z.array(z.string()).optional(),
    /** Unrelated worktree dirtiness notices (todo 3 contract: todo 9 books them). */
    dirtyWorktree: z.array(z.strictObject({ xy: z.string(), file: z.string() })).optional(),
    benchProvenance: z.strictObject({
      benchType: z.enum(["toy", "opencode-fixture-scenarios"]),
      versions: z.array(z.strictObject({ bin: z.string().min(1), version: z.string() })),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.source === "candidate" && (data.candidateId === undefined || data.treeSha === undefined || data.commitSha === undefined)) {
      ctx.addIssue({ code: "custom", message: "candidate rows require candidateId, commitSha and treeSha" });
    }
  });
export type GenerationRowData = z.infer<typeof generationRowDataSchema>;
export type GenerationVerdict = (typeof VERDICTS)[number];

export function decodeGenerationRecord(record: LedgerRecord): GenerationRowData {
  const result = generationRowDataSchema.safeParse(record.data);
  if (!result.success) {
    cannotAnswer(
      `ledger: generation_complete row at ${record.ts} (${String(record.genId ?? "?")}) is unreadable: ${result.error.issues[0]?.message ?? "schema"}`,
      "the ledger is append-only — restore it from backup rather than editing rows",
    );
  }
  return result.data;
}

export interface ResumeState {
  /** Latest incumbent row keyed by the HEAD it benched (matched against openGenome head). */
  readonly incumbentByHead: ReadonlyMap<string, GenerationRowData>;
  /** Latest row per candidate content tree. */
  readonly candidatesByTree: ReadonlyMap<string, GenerationRowData>;
  readonly counters: BudgetCounters;
  readonly rowCount: number;
}

export function readResume(ledger: Ledger): ResumeState {
  const incumbentByHead = new Map<string, GenerationRowData>();
  const candidatesByTree = new Map<string, GenerationRowData>();
  let counters: BudgetCounters = { candidates: 0, modelCalls: 0, tokens: 0, wallS: 0 };
  let rowCount = 0;
  for (const record of ledger.readAll()) {
    if (record.kind !== LEDGER_KIND_GENERATION_COMPLETE) continue;
    const data = decodeGenerationRecord(record);
    rowCount += 1;
    counters = addCounters(counters, data.counters);
    if (data.source === "incumbent") incumbentByHead.set(data.headCommit, data);
    else if (data.treeSha !== undefined) candidatesByTree.set(data.treeSha, data);
  }
  return { incumbentByHead, candidatesByTree, counters, rowCount };
}

export interface PlanPeek {
  readonly rowCount: number;
  readonly counters: BudgetCounters;
  readonly incumbentHeads: readonly string[];
  readonly candidateCount: number;
  readonly lastCompleteGenId: string | null;
}

/**
 * Read-only ledger peek for --dry-run: NEVER Ledger.open (that would mkdir
 * .state — dry-run must leave the repo byte-untouched). A corrupt line is a
 * clean exit 2, matching the real run's integrity stance.
 */
export function peekPlanState(genomeRepo: string): PlanPeek {
  let text: string;
  try {
    text = readFileSync(ledgerPath(genomeRepo), "utf8");
  } catch {
    return { rowCount: 0, counters: emptyCounters(), incumbentHeads: [], candidateCount: 0, lastCompleteGenId: null };
  }
  const incumbentHeads: string[] = [];
  let counters = emptyCounters();
  let rowCount = 0;
  let candidateCount = 0;
  let lastCompleteGenId: string | null = null;
  const lines = text.split("\n").filter((line) => line.length > 0);
  lines.forEach((line, index) => {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      cannotAnswer(`run --dry-run: ledger line ${String(index + 1)} in ${ledgerPath(genomeRepo)} is not valid JSON`);
    }
    const parsed = ledgerRecordSchema.safeParse(record);
    if (!parsed.success) {
      cannotAnswer(`run --dry-run: ledger line ${String(index + 1)} in ${ledgerPath(genomeRepo)} failed schema validation`);
    }
    if (parsed.data.kind !== LEDGER_KIND_GENERATION_COMPLETE) return;
    const data = decodeGenerationRecord(parsed.data);
    rowCount += 1;
    counters = addCounters(counters, data.counters);
    if (data.source === "incumbent") incumbentHeads.push(data.headCommit);
    else candidateCount += 1;
    if (parsed.data.genId !== undefined) lastCompleteGenId = parsed.data.genId;
  });
  return { rowCount, counters, incumbentHeads, candidateCount, lastCompleteGenId };
}

export function emptyCounters(): BudgetCounters {
  return { candidates: 0, modelCalls: 0, tokens: 0, wallS: 0 };
}

export function addCounters(a: BudgetCounters, b: BudgetCounters): BudgetCounters {
  return {
    candidates: a.candidates + b.candidates,
    modelCalls: a.modelCalls + b.modelCalls,
    tokens: a.tokens + b.tokens,
    wallS: round3(a.wallS + b.wallS),
  };
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

