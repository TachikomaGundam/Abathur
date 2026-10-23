// Todo 2 pins: crash-safe locks + friction queue (plan AC d, e, f).
// RED first. The genome lock must exit 2 naming a live holder, take over a
// provably-dead holder with a ledger event, and serialize cross-process
// friction appends without interleaving.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../core/ids.js";
import {
  LEDGER_KIND_LOCK_TAKEOVER,
  Ledger,
  acquireGenomeLock,
  acquireLock,
  appendFriction,
  frictionQueuePath,
  lockDirFor,
  readFriction,
} from "../core/ledger.js";
import { ExitSignal } from "../exit.js";
import { FIXED_CLOCK, freshPair, isAlive, rawLines } from "./testutil.js";

function seedStaleLock(config: string, key: string, owner: { pid: number } | null): string {
  const dir = lockDirFor(config, key);
  mkdirSync(dir, { recursive: true });
  if (owner !== null) {
    writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ ...owner, createdAt: "x", label: "genome" }));
  }
  return dir;
}

// -------------------------------------------------------------------- locks

test("live holder blocks the second acquirer: exit 2 naming holder pid (AC d)", async (t) => {
  const { config } = await freshPair(t);
  const lease = acquireLock({ configDir: config, key: "fp-live", ...FIXED_CLOCK });
  assert.ok(existsSync(path.join(lease.lockDir, "owner.json")));
  assert.throws(
    () => acquireLock({ configDir: config, key: "fp-live", ...FIXED_CLOCK }),
    (e: unknown) =>
      e instanceof ExitSignal &&
      e.code === 2 &&
      e.message.includes(`pid ${process.pid}`) &&
      e.message.includes("fp-live"),
  );
  lease.release();
  assert.ok(!existsSync(lease.lockDir));
  acquireLock({ configDir: config, key: "fp-live", ...FIXED_CLOCK }).release();
});

test("dead-PID holder is taken over; a lock_takeover event lands in the genome ledger (AC e)", async (t) => {
  const { genome, config } = await freshPair(t);
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  if (deadPid === undefined) throw new Error("fixture must yield a child pid");
  assert.ok(!isAlive(deadPid), "fixture pid must be provably dead");
  const staleDir = seedStaleLock(config, "fp-dead", { pid: deadPid });

  const ledger = Ledger.open(genome, FIXED_CLOCK);
  const lease = acquireGenomeLock({ ledger, configDir: config, genomeFp: "fp-dead", ...FIXED_CLOCK });
  assert.equal(lease.lockDir, staleDir);
  assert.equal(JSON.parse(readFileSync(path.join(staleDir, "owner.json"), "utf8")).pid, process.pid);
  const takeover = ledger.readAll().filter((r) => r.kind === LEDGER_KIND_LOCK_TAKEOVER);
  assert.equal(takeover.length, 1);
  assert.deepEqual(takeover[0]?.data, { lockKey: "fp-dead", stalePid: deadPid, takenOverByPid: process.pid });
  assert.deepEqual(readdirSync(path.join(config, ".locks")), ["fp-dead.lock"], "stale quarantine must be cleaned up");
  lease.release();
});

test("lock dir without a readable owner.json is stale (crash mid-acquire) and taken over", async (t) => {
  const { genome, config } = await freshPair(t);
  seedStaleLock(config, "fp-empty", null);
  const ledger = Ledger.open(genome, FIXED_CLOCK);
  const lease = acquireGenomeLock({ ledger, configDir: config, genomeFp: "fp-empty", ...FIXED_CLOCK });
  assert.deepEqual(
    ledger.readAll().map((r) => r.data.stalePid),
    [null],
  );
  lease.release();
});

// ------------------------------------------------------------- friction queue

test("friction queue lives under config home and validates every append", async (t) => {
  const { config } = await freshPair(t);
  assert.equal(frictionQueuePath(config), path.join(config, "friction.jsonl"));
  const rec = appendFriction(config, { kind: "friction", data: { genome: "g1", note: "slow" } }, FIXED_CLOCK);
  assert.equal(rec.kind, "friction");
  assert.deepEqual(readFriction(config).map((r) => canonicalJson(r)), [canonicalJson(rec)]);
  assert.throws(() => appendFriction(config, { kind: "" }, FIXED_CLOCK), Error);
  assert.equal(rawLines(frictionQueuePath(config)).length, 1, "failed append wrote nothing");
});

test("two genomes append 200 friction records each concurrently: 400 clean zod-valid lines (AC f)", async (t) => {
  const { config } = await freshPair(t);
  const writer = fileURLToPath(new URL("./fixtures/friction-writer.js", import.meta.url));
  const run = (source: string) =>
    new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [writer, config, source, "200"], { stdio: "inherit" });
      child.on("error", reject);
      child.on("close", resolve);
    });
  assert.deepEqual(await Promise.all([run("genome-a"), run("genome-b")]), [0, 0]);
  const lines = rawLines(frictionQueuePath(config));
  assert.equal(lines.length, 400, "no interleaved/partial lines under concurrent appends");
  const parsed = readFriction(config);
  assert.equal(parsed.length, 400);
  for (const source of ["genome-a", "genome-b"]) {
    const seqs = parsed
      .filter((r) => r.data.source === source)
      .map((r) => Number(r.data.seq))
      .sort((x, y) => x - y);
    assert.deepEqual(seqs, Array.from({ length: 200 }, (_, i) => i), `${source}: all records intact`);
  }
});

test("friction append waits for a live holder within budget, then exits 2 naming the pid", async (t) => {
  const { config } = await freshPair(t);
  const held = acquireLock({ configDir: config, key: "friction", ...FIXED_CLOCK });
  assert.throws(
    () => appendFriction(config, { kind: "friction", data: {} }, { ...FIXED_CLOCK, waitMs: 30 }),
    (e: unknown) => e instanceof ExitSignal && e.code === 2 && e.message.includes(`pid ${process.pid}`),
  );
  held.release();
  appendFriction(config, { kind: "friction", data: { afterRelease: true } }, FIXED_CLOCK);
  assert.equal(readFriction(config).length, 1);
});
