// Structured friction digests (plan todo 11a): every run appends ONE fixed-shape
// friction_digest record to the global queue <configDir>/friction.jsonl (todo-2
// guarded helpers — lock + schema envelope + tail repair come free). Stalls,
// repeated rejections (todo-8 stage/reason counts), inconclusive causes and CLI
// errors are COUNTS and ENUMS, never free text: every string field passes
// scrub() (printable-ASCII, single line, bounded).
//
// VAL LEAK GATE (plan 157-164, the core rule): material from val-split units
// contributes counts, alias positions and sample numbers ONLY — unit ids,
// paths, scenario text and failure strings sourced from val runs can never
// enter a record, because the queue is mutator-adjacent context downstream.

import { z } from "zod";

import type { ExitCode } from "../../exit.js";
import {
  appendFriction,
  LedgerError,
  readFriction,
  type FrictionOptions,
  type LedgerRecord,
  type LedgerRecordInput,
} from "../ledger.js";
export const FRICTION_KIND = "friction_digest";

/** Rejection stages as produced by todo-8 (candidate.ts schema|syntax|path + driver apply|parse). */
export const REJECT_STAGES = ["schema", "syntax", "path", "apply", "parse"] as const;

const MAX_REASONS = 10;
const MAX_TRAIN_UNITS = 32;
const MAX_FAILURES_PER_UNIT = 4;
const MAX_REASON_CHARS = 200;
const MAX_UNIT_ID_CHARS = 120;

/** Printable-ASCII, single line, bounded — the queue never carries ANSI or newlines. */
export function scrub(value: string, max = MAX_REASON_CHARS): string {
  const one = value.replace(/[^ -~]/g, " ").replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, Math.max(0, max - 3))}...`;
}

export const frictionCauseSchema = z.enum(["run-summary", "cli-error", "self-eval"]);
export type FrictionCause = z.infer<typeof frictionCauseSchema>;

export const frictionStageCountsSchema = z.strictObject({
  schema: z.number().int().nonnegative(),
  syntax: z.number().int().nonnegative(),
  path: z.number().int().nonnegative(),
  apply: z.number().int().nonnegative(),
  parse: z.number().int().nonnegative(),
});

export const frictionDigestSchema = z.strictObject({
  genomeFp: z.string().regex(/^[0-9a-f]{16}$/),
  cause: frictionCauseSchema,
  exit: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  complete: z.boolean(),
  counts: z.strictObject({
    applied: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    benched: z.number().int().nonnegative(),
    inconclusive: z.number().int().nonnegative(),
    nominated: z.number().int().nonnegative(),
    timeouts: z.number().int().nonnegative(),
    reaped: z.number().int().nonnegative(),
  }),
  rejections: z.strictObject({ total: z.number().int().nonnegative(), byStage: frictionStageCountsSchema }),
  stall: z.strictObject({ budgetTruncated: z.boolean(), orphanGroups: z.number().int().nonnegative() }),
  train: z
    .array(
      z.strictObject({
        unitId: z.string().min(1).max(MAX_UNIT_ID_CHARS),
        n: z.number().int().nonnegative(),
        mean: z.number().finite(),
        failures: z.array(z.string().min(1).max(MAX_REASON_CHARS)).max(MAX_FAILURES_PER_UNIT),
      }),
    )
    .max(MAX_TRAIN_UNITS),
  val: z.strictObject({
    count: z.number().int().nonnegative(),
    aliases: z.array(z.string().regex(/^val-[0-9]+$/)).max(64),
    samples: z.number().int().nonnegative(),
  }),
  reasons: z.array(z.string().min(1).max(MAX_REASON_CHARS)).max(MAX_REASONS),
});
export type FrictionDigest = z.infer<typeof frictionDigestSchema>;

export interface FrictionUnitEvidence {
  readonly unitId: string;
  readonly split: "train" | "val";
  readonly scores: readonly number[];
  readonly failures: readonly string[];
}

export interface RunFrictionInput {
  readonly genomeFp: string;
  readonly cause: FrictionCause;
  readonly runId?: string | undefined;
  readonly exit: ExitCode;
  readonly complete: boolean;
  readonly counts: FrictionDigest["counts"];
  readonly rejected: readonly { readonly stage: string; readonly reason: string }[];
  readonly units: readonly FrictionUnitEvidence[];
  readonly reasons: readonly string[];
  readonly stall: { readonly budgetTruncated: boolean; readonly orphanGroups: number };
}

function meanOf(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Pure builder: sanitizes + bounds every string, then schema-parses (fail-closed). */
export function buildRunFriction(input: RunFrictionInput): LedgerRecordInput {
  const byStage: Record<(typeof REJECT_STAGES)[number], number> = { schema: 0, syntax: 0, path: 0, apply: 0, parse: 0 };
  const unknownStages: string[] = [];
  for (const rejection of input.rejected) {
    const hit = REJECT_STAGES.find((stage) => stage === rejection.stage);
    if (hit !== undefined) byStage[hit] += 1;
    else unknownStages.push(`rejection stage '${scrub(rejection.stage, 40)}': ${scrub(rejection.reason)}`);
  }
  const train: FrictionDigest["train"] = [];
  let valCount = 0;
  let valSamples = 0;
  const valAliases: string[] = [];
  for (const unit of input.units) {
    if (unit.split === "val") {
      valAliases.push(`val-${String(valCount + 1)}`);
      valCount += 1;
      valSamples += unit.scores.length;
      continue;
    }
    if (train.length >= MAX_TRAIN_UNITS) continue;
    train.push({
      unitId: scrub(unit.unitId, MAX_UNIT_ID_CHARS),
      n: unit.scores.length,
      mean: Number(meanOf(unit.scores).toFixed(6)),
      failures: unit.failures.map((f) => scrub(f)).filter((f) => f.length > 0).slice(0, MAX_FAILURES_PER_UNIT),
    });
  }
  const data: FrictionDigest = frictionDigestSchema.parse({
    genomeFp: input.genomeFp,
    cause: input.cause,
    exit: input.exit,
    complete: input.complete,
    counts: input.counts,
    rejections: { total: input.rejected.length, byStage },
    stall: { budgetTruncated: input.stall.budgetTruncated, orphanGroups: input.stall.orphanGroups },
    train,
    val: { count: valCount, aliases: valAliases, samples: valSamples },
    reasons: [...input.reasons.map((r) => scrub(r)).filter((r) => r.length > 0).slice(0, MAX_REASONS), ...unknownStages].slice(0, MAX_REASONS),
  });
  return input.runId === undefined
    ? { kind: FRICTION_KIND, data }
    : { kind: FRICTION_KIND, runId: scrub(input.runId, 160), data };
}

export function appendRunFriction(
  configDir: string,
  input: RunFrictionInput,
  opts: FrictionOptions = {},
): LedgerRecord {
  return appendFriction(configDir, buildRunFriction(input), opts);
}

export interface FrictionRead {
  readonly digests: readonly FrictionDigest[];
  readonly error: string | null;
}

/**
 * Fail-closed queue reader: a corrupt line yields a readable error naming the
 * file and line (never a crash, never a silent skip); foreign record kinds are
 * refused like corruption — the queue holds friction_digest records only.
 */
export function readFrictionDigests(configDir: string): FrictionRead {
  let records: readonly LedgerRecord[];
  try {
    records = readFriction(configDir);
  } catch (error) {
    if (error instanceof LedgerError) return { digests: [], error: error.message };
    throw error;
  }
  const digests: FrictionDigest[] = [];
  for (const [index, record] of records.entries()) {
    if (record.kind !== FRICTION_KIND) {
      return { digests, error: `friction: line ${String(index + 1)} has kind '${record.kind}', expected '${FRICTION_KIND}'` };
    }
    const parsed = frictionDigestSchema.safeParse(record.data);
    if (!parsed.success) {
      return { digests, error: `friction: line ${String(index + 1)} failed ${FRICTION_KIND} schema: ${parsed.error.issues[0]?.message ?? "schema"}` };
    }
    digests.push(parsed.data);
  }
  return { digests, error: null };
}
