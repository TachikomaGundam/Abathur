// Append-only per-genome ledger + crash resume + friction queue (plan todo 2).
// One JSONL file per genome at <genomeRepo>/.state/abathur/ledger.jsonl.
// Discipline (border/README.md precedent): lines are only ever appended, never
// rewritten or truncated — the sole exception is the corrupt-TAIL quarantine
// at open, which MOVES the original bytes to ledger.corrupt-<ts> and keeps the
// intact prefix byte-for-byte. Every read re-validates every line with zod;
// mid-file corruption is an integrity error, never a silent skip.

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { canonicalJson, compactUtc } from "./ids.js";
import { acquireLock, type LockLease } from "./locks.js";

export { acquireLock, lockDirFor, type LockLease, type LockOptions } from "./locks.js";

export const LEDGER_KIND_LOCK_TAKEOVER = "lock_takeover";
export const LEDGER_KIND_GENERATION_COMPLETE = "generation_complete";

export const ledgerRecordSchema = z.strictObject({
  v: z.literal(1),
  ts: z.string().min(1),
  kind: z.string().min(1),
  genId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()),
});
export type LedgerRecord = z.infer<typeof ledgerRecordSchema>;

export interface LedgerRecordInput {
  readonly kind: string;
  readonly data?: Record<string, unknown> | undefined;
  readonly ts?: string | undefined;
  readonly genId?: string | undefined;
  readonly runId?: string | undefined;
}

export class LedgerError extends Error {
  constructor(
    readonly kind: "integrity",
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

export interface LedgerOpenOptions {
  readonly now?: (() => Date) | undefined;
}

export function ledgerPath(genomeRepo: string): string {
  return path.join(genomeRepo, ".state", "abathur", "ledger.jsonl");
}

function buildRecord(input: LedgerRecordInput, now: () => Date): LedgerRecord {
  const candidate: LedgerRecord = {
    v: 1,
    ts: input.ts ?? now().toISOString(),
    kind: input.kind,
    data: input.data ?? {},
  };
  if (input.genId !== undefined) candidate.genId = input.genId;
  if (input.runId !== undefined) candidate.runId = input.runId;
  return ledgerRecordSchema.parse(candidate); // invalid input never reaches the file
}

/** ONE write() per record: fully serialized line, O_APPEND, partial-write loop is the only retry. */
function appendSerialized(filePath: string, record: LedgerRecord): void {
  const bytes = Buffer.from(`${canonicalJson(record)}\n`, "utf8");
  const fd = openSync(filePath, "a");
  try {
    let written = 0;
    while (written < bytes.length) written += writeSync(fd, bytes, written);
  } finally {
    closeSync(fd);
  }
}

function parseLine(line: string, filePath: string, lineNo: number): LedgerRecord {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (error) {
    throw new LedgerError(
      "integrity",
      `${filePath}: line ${lineNo} is not valid JSON: ${(error as Error).message}`,
    );
  }
  const parsed = ledgerRecordSchema.safeParse(json);
  if (!parsed.success) {
    throw new LedgerError("integrity", `${filePath}: line ${lineNo} failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

function validateCompleteLines(prefix: Buffer, filePath: string): LedgerRecord[] {
  if (prefix.length === 0) return [];
  const lines = prefix.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const records: LedgerRecord[] = [];
  lines.forEach((line, index) => {
    records.push(parseLine(line, filePath, index + 1));
  });
  return records;
}

/**
 * Load + validate, repairing a crash-truncated tail first. A file not ending
 * in \n means the last record died mid-write (the kernel only splits a single
 * write() on signals, and SIGKILL between mkdir/append leaves byte-prefixed
 * debris too). Repair keeps prior lines byte-identical: rename the original
 * to <name>.corrupt-<ts> (full bytes preserved), then recreate the file with
 * only the newline-terminated prefix.
 */
function loadValidated(filePath: string, now: () => Date): LedgerRecord[] {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const cut = buf.lastIndexOf(0x0a) + 1;
  if (cut === buf.length) return validateCompleteLines(buf, filePath);
  const ext = path.extname(filePath);
  const archive = path.join(
    path.dirname(filePath),
    `${path.basename(filePath, ext)}.corrupt-${compactUtc(now())}-${process.pid}${ext}`,
  );
  renameSync(filePath, archive);
  writeFileSync(filePath, buf.subarray(0, cut));
  return validateCompleteLines(buf.subarray(0, cut), filePath);
}

export class Ledger {
  private constructor(
    readonly genomeRepo: string,
    readonly filePath: string,
    readonly now: () => Date,
  ) {}

  /** Opens, ensures the state dir, quarantines a corrupt tail and validates every line. */
  static open(genomeRepo: string, opts: LedgerOpenOptions = {}): Ledger {
    const filePath = ledgerPath(genomeRepo);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const ledger = new Ledger(genomeRepo, filePath, opts.now ?? (() => new Date()));
    ledger.readAll();
    return ledger;
  }

  append(input: LedgerRecordInput): LedgerRecord {
    const record = buildRecord(input, this.now);
    appendSerialized(this.filePath, record);
    return record;
  }

  readAll(): readonly LedgerRecord[] {
    return loadValidated(this.filePath, this.now);
  }

  /** Resume point for the evolution loop: genId of the last completed generation. */
  lastCompleteGeneration(): string | null {
    let last: string | null = null;
    for (const record of this.readAll()) {
      if (record.kind === LEDGER_KIND_GENERATION_COMPLETE && record.genId !== undefined) {
        last = record.genId;
      }
    }
    return last;
  }
}

export interface GenomeLockOptions {
  readonly ledger: Ledger;
  readonly configDir: string;
  readonly genomeFp: string;
  readonly waitMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
}

/**
 * Single-flight per genome. The lock lives under config home keyed by the
 * genome FINGERPRINT (not repo path) so parallel checkouts of the same genome
 * still contend; a dead holder is replaced and the takeover is booked into
 * the genome's own ledger before the lease is handed out.
 */
export function acquireGenomeLock(opts: GenomeLockOptions): LockLease {
  const { ledger, configDir, genomeFp } = opts;
  const lease = acquireLock({
    configDir,
    key: genomeFp,
    label: "genome lock",
    waitMs: opts.waitMs,
    now: opts.now,
  });
  if (lease.tookOverFrom !== null) {
    ledger.append({
      kind: LEDGER_KIND_LOCK_TAKEOVER,
      data: { lockKey: genomeFp, stalePid: lease.tookOverFrom.stalePid, takenOverByPid: process.pid },
    });
  }
  return lease;
}

export interface FrictionOptions {
  readonly waitMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
}

/** Global friction queue (todo 11 consumes): <configDir>/friction.jsonl. */
export function frictionQueuePath(configDir: string): string {
  return path.join(configDir, "friction.jsonl");
}

/** Guarded by .locks/friction.lock; every genome can append without corrupting another's line. */
export function appendFriction(
  configDir: string,
  input: LedgerRecordInput,
  opts: FrictionOptions = {},
): LedgerRecord {
  const now = opts.now ?? (() => new Date());
  const record = buildRecord(input, now);
  const lease = acquireLock({
    configDir,
    key: "friction",
    label: "friction lock",
    waitMs: opts.waitMs ?? 15_000,
    now,
  });
  try {
    appendSerialized(frictionQueuePath(configDir), record);
  } finally {
    lease.release();
  }
  return record;
}

export function readFriction(configDir: string): readonly LedgerRecord[] {
  return loadValidated(frictionQueuePath(configDir), () => new Date());
}
