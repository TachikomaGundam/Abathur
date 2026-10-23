// Active-child tracking + orphan reaping for the run-loop (plan todo 9).
//
// Every child the loop spawns (mutator, bench unit, grader, engine probe) is
// recorded in <genomeRepo>/.state/abathur/active-children.jsonl the instant it
// spawns — BEFORE any await — with its pid. Children run detached (pid ===
// pgid, see bench/adapter.ts runChild), so the recorded pid doubles as the
// process-group id and the reap can SIGKILL whole groups.
//
// Reaper contract (startup of every `abathur run`):
//   - ONLY pids present in this log are ever signalled — an unrecorded process
//     is off-limits, always;
//   - the log is read at startup only while the genome lock is held, so every
//     entry belongs to a DEAD prior run; liveness is recorded per entry
//     (kill-0: ESRCH dead, EPERM foreign-but-alive) and the group gets
//     kill(-pgid, SIGKILL), ESRCH being a benign no-op;
//   - self pid and structurally invalid records are skipped (never killed);
//   - malformed lines are counted and skipped: corrupt tracking state must
//     degrade the reap, never crash the run;
//   - after killing, the log is truncated — reap is once-per-entry.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { canonicalJson } from "../ids.js";
import type { ChildHandle } from "../../bench/adapter.js";

export interface ChildRecord {
  readonly v: 1;
  readonly pid: number;
  readonly pgid: number;
  readonly genId: string;
  readonly kind: string;
  readonly at: string;
}

export interface ReapEntry {
  readonly pid: number;
  /** Whether the leader pid answered kill-0 when the reap observed it. */
  readonly alive: boolean;
}

export interface ReapReport {
  readonly reaped: readonly ReapEntry[];
  readonly skipped: readonly string[];
  readonly malformed: number;
}

export function activeChildrenPath(genomeRepo: string): string {
  return path.join(genomeRepo, ".state", "abathur", "active-children.jsonl");
}

function parseRecord(line: string): ChildRecord | null {
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const raw = doc as Record<string, unknown>;
  const { pid, pgid, genId } = raw;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return null;
  const resolvedGid = typeof pgid === "number" && Number.isInteger(pgid) && pgid > 1 ? pgid : pid;
  if (typeof genId !== "string" || genId.length === 0) return null;
  const kindVal = raw["kind"];
  const atVal = raw["at"];
  return {
    v: 1,
    pid,
    pgid: resolvedGid,
    genId,
    kind: typeof kindVal === "string" && kindVal.length > 0 ? kindVal : "child",
    at: typeof atVal === "string" ? atVal : "",
  };
}

/** Tolerant reader: malformed lines yield nothing, the file may be absent. */
export function readChildRecords(genomeRepo: string): readonly ChildRecord[] {
  let text: string;
  try {
    text = readFileSync(activeChildrenPath(genomeRepo), "utf8");
  } catch {
    return [];
  }
  const out: ChildRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const rec = parseRecord(line);
    if (rec !== null) out.push(rec);
  }
  return out;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // foreign-owned ⇒ alive
  }
}

function killGroup(pgid: number): "sent" | "already-gone" | "foreign" {
  try {
    process.kill(-pgid, "SIGKILL");
    return "sent";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "already-gone";
    return "foreign";
  }
}

/**
 * SIGKILL every recorded group of the dead prior run(s), then truncate the log.
 * Call only under the genome lock: live entries from a concurrent run must
 * never pass through here.
 */
export function reapOrphans(genomeRepo: string): ReapReport {
  const filePath = activeChildrenPath(genomeRepo);
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return { reaped: [], skipped: [], malformed: 0 }; // no tracking state ⇒ nothing to reap
  }
  const reaped: ReapEntry[] = [];
  const skipped: string[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const rec = parseRecord(line);
    if (rec === null) {
      malformed += 1;
      continue;
    }
    if (rec.pid === process.pid) {
      skipped.push(`self pid ${String(rec.pid)} (never kill own process group)`);
      continue;
    }
    const alive = pidAlive(rec.pid);
    const outcome = killGroup(rec.pgid);
    if (outcome === "foreign") {
      skipped.push(`pid ${String(rec.pid)} group is foreign-owned (EPERM)`);
      continue;
    }
    reaped.push({ pid: rec.pid, alive });
  }
  writeFileSync(filePath, "", "utf8"); // truncate AFTER kills: a crash mid-reap re-kills idempotently
  return { reaped, skipped, malformed };
}

/**
 * Live-run recorder: an entry appears the moment a child spawns and vanishes
 * when it exits, so a clean run leaves an empty log and a crashed run leaves
 * exactly its orphans for the next reap. All file mutations are synchronous —
 * there is no await window between spawn and record.
 */
export class ChildTracker {
  private readonly filePath: string;
  private genId = "unassigned";
  private kind = "child";
  private readonly pending = new Set<Promise<void>>();

  constructor(genomeRepo: string) {
    this.filePath = activeChildrenPath(genomeRepo);
  }

  /** Tag every child spawned from here on (phase transitions are sequential). */
  phase(genId: string, kind: string): void {
    this.genId = genId;
    this.kind = kind;
  }

  /** Adapter-facing ChildOptions.onChild sink: append-before-exec, remove-on-exit. */
  readonly onChild = (handle: ChildHandle): void => {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const record: ChildRecord = {
      v: 1,
      pid: handle.pid,
      pgid: handle.pid, // runChild spawns detached ⇒ child.pid is its own process-group id
      genId: this.genId,
      kind: this.kind,
      at: new Date().toISOString(),
    };
    writeFileSync(this.filePath, `${canonicalJson(record)}\n`, { flag: "a" });
    const settled = handle.exited.then(() => {
      this.pending.delete(settled);
      this.remove(handle.pid);
    });
    this.pending.add(settled);
  };

  /** Resolve once every recorded child that exited has been removed from the log. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  private remove(pid: number): void {
    let text: string;
    try {
      text = readFileSync(this.filePath, "utf8");
    } catch {
      return; // truncation (e.g. a reap) already owns the log
    }
    const lines = text.split("\n").filter((line) => line.length > 0);
    const kept = lines.filter((line) => {
      const rec = parseRecord(line);
      return rec === null || rec.pid !== pid; // malformed lines survive until the next reap
    });
    if (kept.length === lines.length) return;
    const body = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
    const tmp = `${this.filePath}.tmp-${String(pid)}`;
    writeFileSync(tmp, body, "utf8");
    renameSync(tmp, this.filePath); // atomic swap: a crash mid-rewrite never truncates live entries
  }
}
