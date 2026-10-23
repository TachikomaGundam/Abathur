// Campaign lock pins (Tier-1 v9): the payload written by `abathur run` is the
// contract the plugin's T2/T5 readers parse — shape, heartbeat, close, and the
// fail-open degradation paths are all pinned here.

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { campaignLockPath, startCampaignLock } from "../core/campaign-lock.js";
import { engineVersion } from "../version.js";

async function freshRepo(t: { after: (fn: () => unknown) => void }): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "abathur-campaign-lock-"));
  t.after(() => {
    rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("start writes the payload contract: pid/startedAt/runId/engineVersion", async (t) => {
  const repo = await freshRepo(t);
  const handle = startCampaignLock({ selfRepo: repo, runId: "campaign-test-1" });
  assert.ok(handle !== null, "writable repo must yield a handle");
  assert.equal(handle.path, campaignLockPath(repo));
  assert.ok(existsSync(handle.path));
  const payload = JSON.parse(readFileSync(handle.path, "utf8")) as Record<string, unknown>;
  assert.equal(payload["pid"], process.pid);
  assert.equal(payload["runId"], "campaign-test-1");
  assert.equal(payload["engineVersion"], engineVersion());
  assert.ok(typeof payload["startedAt"] === "string" && !Number.isNaN(Date.parse(payload["startedAt"] as string)));
  handle.close();
  assert.ok(!existsSync(handle.path), "close unlinks the lock");
});

test("touch refreshes mtime (heartbeat step)", async (t) => {
  const repo = await freshRepo(t);
  let current = new Date();
  const handle = startCampaignLock({ selfRepo: repo, now: () => current });
  assert.ok(handle !== null);
  const before = statSync(handle.path).mtimeMs;
  current = new Date(Date.now() + 5000);
  handle.touch();
  const after = statSync(handle.path).mtimeMs;
  assert.ok(after > before, "touch must move mtime forward");
  handle.close();
});

test("close refuses to unlink a lock that is no longer ours", async (t) => {
  const repo = await freshRepo(t);
  const handle = startCampaignLock({ selfRepo: repo, runId: "campaign-test-mine" });
  assert.ok(handle !== null);
  const other = startCampaignLock({ selfRepo: repo, runId: "campaign-test-other" });
  assert.ok(other !== null);
  handle.close();
  assert.ok(existsSync(other.path), "someone else's lock survives my close");
  const payload = JSON.parse(readFileSync(other.path, "utf8")) as Record<string, unknown>;
  assert.equal(payload["runId"], "campaign-test-other");
  other.close();
});

test("degradation: missing selfRepo warns and returns null, never throws", async () => {
  const warnings: string[] = [];
  const handle = startCampaignLock({ selfRepo: undefined, warn: (m) => warnings.push(m) });
  assert.equal(handle, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /ABATHUR_SELF_REPO/);
});

test("degradation: unwritable path warns and returns null, never throws", async () => {
  const warnings: string[] = [];
  const handle = startCampaignLock({
    selfRepo: path.join(os.tmpdir(), "abathur-campaign-lock-nonexistent-\0bad"),
    warn: (m) => warnings.push(m),
  });
  assert.equal(handle, null);
  assert.equal(warnings.length, 1);
});

test("degradation: heartbeat of a vanished lock is silent; close is a no-op", async (t) => {
  const repo = await freshRepo(t);
  const handle = startCampaignLock({ selfRepo: repo, heartbeatMs: 5 });
  assert.ok(handle !== null);
  handle.close(); // close before the first tick: no crash, no throw
  handle.touch(); // explicit touch on an unlinked lock: tolerated
});
