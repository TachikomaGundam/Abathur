// Campaign occupancy lock (Tier-1 design v9, proposals/plugin-tier1-design-20261020.md).
//
// One file: <selfRepo>/.omo/evidence/campaign.lock.json, written by the engine
// at `abathur run` start (after the dry-run early return, before the ledger
// opens), heartbeat-touched every 5 minutes, unlinked at normal close. The
// plugin's T2 write guard and T5 occupancy tool READ this file (plus a
// process-level disproof scan) — the engine never reads it back. The payload
// shape is the contract between the two sides and is pinned by tests on both.
//
// Degradation is deliberate and fail-open by design (v9): an unwritable lock
// NEVER blocks a run. The plugin side then falls back to the process disproof
// scan and surfaces "no lock file" as its own signal class.
//
// This module is the engine's ONLY lock-file writer; the plugin never writes it.

import { writeFileSync, unlinkSync, utimesSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import path from "node:path";
import { compactUtc } from "./ids.js";
import { engineVersion } from "../version.js";

export interface CampaignLockPayload {
  readonly pid: number;
  readonly startedAt: string;
  readonly runId: string;
  readonly engineVersion: string;
}

export interface CampaignLockHandle {
  readonly path: string;
  readonly payload: CampaignLockPayload;
  /** Refresh mtime (heartbeat step). Exposed for tests; the interval calls it too. */
  readonly touch: () => void;
  /** Normal close: stop the heartbeat and unlink the lock if it is still ours. */
  readonly close: () => void;
}

export const CAMPAIGN_LOCK_RELATIVE = path.join(".omo", "evidence", "campaign.lock.json");
export const CAMPAIGN_LOCK_HEARTBEAT_MS = 5 * 60 * 1000;

export function campaignLockPath(selfRepo: string): string {
  return path.join(selfRepo, CAMPAIGN_LOCK_RELATIVE);
}

export interface StartCampaignLockOptions {
  /** Repo the campaign runs against; the lock lives in its .omo/evidence/. */
  readonly selfRepo: string | undefined;
  readonly runId?: string;
  readonly now?: () => Date;
  readonly heartbeatMs?: number;
  /** Operational warnings (never stdout — stdout is machine output). */
  readonly warn?: (message: string) => void;
}

const defaultWarn = (message: string): void => {
  process.stderr.write(`abathur: campaign-lock degraded: ${message}\n`);
};

/**
 * Write the campaign lock and start the heartbeat. Returns null (with a
 * warning) when the lock cannot be established — the caller proceeds without
 * it. Never throws.
 */
export function startCampaignLock(options: StartCampaignLockOptions): CampaignLockHandle | null {
  const warn = options.warn ?? defaultWarn;
  const now = options.now ?? (() => new Date());
  const selfRepo = options.selfRepo;
  if (selfRepo === undefined || selfRepo.length === 0) {
    warn("$ABATHUR_SELF_REPO is not set; plugin occupancy guard runs in disproof-only mode");
    return null;
  }
  const lockPath = campaignLockPath(selfRepo);
  const payload: CampaignLockPayload = {
    pid: process.pid,
    startedAt: now().toISOString(),
    runId: options.runId ?? `campaign-${compactUtc(now())}-${String(process.pid)}`,
    engineVersion: engineVersion(),
  };
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(payload) + "\n", "utf8");
  } catch (error) {
    warn(`cannot write ${lockPath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const touch = (): void => {
    try {
      const t = now();
      utimesSync(lockPath, t, t);
    } catch {
      // Lock vanished or became unwritable mid-run: heartbeat silently stops
      // mattering; the close path and the plugin's mtime check tolerate both.
    }
  };
  const interval = setInterval(touch, options.heartbeatMs ?? CAMPAIGN_LOCK_HEARTBEAT_MS);
  interval.unref(); // never hold the process open for the heartbeat

  const close = (): void => {
    clearInterval(interval);
    try {
      if (!existsSync(lockPath)) return;
      // Only unlink a lock that is still ours — never someone else's.
      const current: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
      if (
        typeof current === "object" &&
        current !== null &&
        (current as { pid?: unknown }).pid === payload.pid &&
        (current as { runId?: unknown }).runId === payload.runId
      ) {
        unlinkSync(lockPath);
      }
    } catch {
      // Close is best-effort; a leftover stale lock is a handled signal class
      // on the plugin side (dead pid + stale mtime), not an error here.
    }
  };

  return { path: lockPath, payload, touch, close };
}
