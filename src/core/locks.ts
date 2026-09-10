// mkdir-atomic advisory locks (plan todo 2). Lives under CONFIG HOME
// (<configDir>/.locks/<key>.lock) on purpose: keyed by genome fingerprint and
// shared across clones/machine-local paths, so single-flight survives the
// genome repo being cloned or moved.
//
// Protocol:
//  - acquire = mkdirSync(lockDir) — exclusive at the kernel level; the winner
//    immediately writes owner.json {pid, createdAt, label}.
//  - EEXIST  = read owner.json and probe liveness via process.kill(pid, 0):
//    ESRCH -> dead, EPERM -> alive (foreign user), success -> alive.
//  - stale takeover uses renameSync(lockDir, <lockDir>.stale-<nonce>) rather
//    than rm+mkdir: rename is atomic, so when two acquirers race to reclaim,
//    exactly one succeeds and the loser re-runs acquisition against the
//    freshly-mkdir'd winner. rm-then-mkdir would let both "win".
//  - release removes the dir only while owner.json still names us, so a lease
//    we no longer hold can never clobber a legitimate new holder.
//
//  - an unreadable owner.json alone does NOT prove staleness: a fresh holder
//    is microseconds from writing it, so a lock younger than STALE_GRACE_MS
//    (by dir mtime) is still honoured; only after the grace is a missing
//    owner treated as "holder died between mkdir and owner-write". Without
//    the grace, a racer can rename away a lock a live holder just created —
//    caught by the two-writer friction test on the first run.
// Remaining accepted race: Linux PID reuse can mislabel a dead holder as
// live until the lock is manually cleared.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cannotAnswer } from "../exit.js";
import { canonicalJson } from "./ids.js";

const OWNER_FILE = "owner.json";

export interface OwnerInfo {
  readonly pid: number;
  readonly createdAt: string;
  readonly label: string;
}

export interface StaleTakeover {
  readonly stalePid: number | null;
}

export interface LockLease {
  readonly lockDir: string;
  readonly key: string;
  readonly tookOverFrom: StaleTakeover | null;
  release(): void;
}

export interface LockOptions {
  readonly configDir: string;
  readonly key: string;
  readonly waitMs?: number | undefined;
  readonly label?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export function lockDirFor(configDir: string, key: string): string {
  if (key.length === 0 || key.includes("/") || key.includes(path.sep) || key === "..") {
    throw new TypeError(`lock key '${key}' is not a safe directory name`);
  }
  return path.join(configDir, ".locks", `${key}.lock`);
}

function readOwner(lockDir: string): OwnerInfo | null {
  let raw: { pid?: unknown; createdAt?: unknown; label?: unknown };
  try {
    raw = JSON.parse(readFileSync(path.join(lockDir, OWNER_FILE), "utf8")) as typeof raw;
  } catch {
    return null; // absent or unparseable — see protocol note above
  }
  if (typeof raw.pid !== "number" || !Number.isInteger(raw.pid) || raw.pid <= 0) return null;
  return {
    pid: raw.pid,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "unknown",
    label: typeof raw.label === "string" ? raw.label : "unknown",
  };
}

const STALE_GRACE_MS = 250;

function lockDirIsFresh(lockDir: string): boolean {
  try {
    return Date.now() - statSync(lockDir).mtimeMs < STALE_GRACE_MS;
  } catch {
    return false; // dir vanished mid-observe; the next mkdir/rename resolves the race
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeOwner(lockDir: string, label: string, now: () => Date): void {
  const owner = canonicalJson({ createdAt: now().toISOString(), label, pid: process.pid });
  writeFileSync(path.join(lockDir, OWNER_FILE), `${owner}\n`, "utf8");
}

export function acquireLock(opts: LockOptions): LockLease {
  const { configDir, key } = opts;
  const lockDir = lockDirFor(configDir, key);
  mkdirSync(path.dirname(lockDir), { recursive: true }); // the .locks/ parent, not the lock itself
  const label = opts.label ?? "lock";
  const now = opts.now ?? (() => new Date());
  const deadline = Date.now() + (opts.waitMs ?? 0);
  let takeovers = 0;
  let reclaimed: StaleTakeover | null = null;

  for (;;) {
    try {
      mkdirSync(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readOwner(lockDir);
      if (owner === null && lockDirIsFresh(lockDir)) {
        sleepSync(2); // a live holder may be mid-owner-write; re-observe next pass
        continue;
      }
      if (owner !== null && pidAlive(owner.pid)) {
        reclaimed = null; // a fresh occupant took over: our old reclaim is not ours to book
        if (Date.now() < deadline) {
          sleepSync(2);
          continue;
        }
        cannotAnswer(
          `${label} '${key}' is held by live pid ${owner.pid} (since ${owner.createdAt})`,
          `wait for it to finish; remove ${lockDir} only once that pid is gone`,
        );
      }
      takeovers += 1;
      if (takeovers > 8) {
        cannotAnswer(`lock '${key}' is churn: 8 takeover races lost`, lockDir);
      }
      const quarantine = `${lockDir}.stale-${process.pid}-${randomUUID().slice(0, 8)}`;
      try {
        renameSync(lockDir, quarantine);
      } catch (race) {
        reclaimed = null; // another taker won the rename — re-observe their lock normally
        continue;
      }
      rmSync(quarantine, { recursive: true, force: true });
      reclaimed = { stalePid: owner?.pid ?? null };
      continue; // retry mkdir; if a competitor wins it, the claim check below resets us
    }
    // mkdir won. Claim, then PROVE the claim: a holder descheduled past the
    // grace can have its brand-new dir stolen between mkdir and owner-write,
    // so verify owner pid AND directory inode (rename+remkdir changes ino).
    // A lost claim retries instead of silently double-holding the lock.
    let wonInode: number | null;
    try {
      wonInode = statSync(lockDir).ino;
    } catch {
      reclaimed = null;
      continue; // dir renamed away before we could even claim it
    }
    try {
      writeOwner(lockDir, label, now);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reclaimed = null;
        continue; // dir was renamed away mid-claim — re-observe
      }
      throw error;
    }
    const claim = readOwner(lockDir);
    let dirInode: number | null;
    try {
      dirInode = statSync(lockDir).ino;
    } catch {
      dirInode = null;
    }
    const ours = claim !== null && claim.pid === process.pid && dirInode === wonInode;
    if (ours) return makeLease(lockDir, key, reclaimed);
    reclaimed = null;
  }
}

function makeLease(lockDir: string, key: string, tookOverFrom: StaleTakeover | null): LockLease {
  return {
    lockDir,
    key,
    tookOverFrom,
    release(): void {
      const owner = readOwner(lockDir);
      if (owner !== null && owner.pid === process.pid) {
        rmSync(lockDir, { recursive: true, force: true });
      }
    },
  };
}
