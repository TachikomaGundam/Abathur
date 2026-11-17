import test from "node:test";
import assert from "node:assert/strict";
import { checkCagePresence, EXIT } from "../kernel/surface/cage-check.mjs";

// W-2026-11-17-E R1 canary fixtures: fake readers mirroring the two worlds.
const HOME = "/home/lab";
const freshIso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

const cageWorld = (overrides = {}) => ({
  env: { CAGE_BORN_AT: "2026-11-17T09:00:00.000Z", LAUNCHER_STARTED_AT: "2026-11-17T08:59:00.000Z" },
  hostHome: HOME,
  logPath: "/fake/cage.log",
  exists: () => true,
  read: (p) => {
    if (p === "/proc/self/status") return "Name:\tbash\nNSpid:\t42\t7\n";
    if (p === "/proc/mounts") return `tmpfs ${HOME} tmpfs rw 0 0\nproc /proc proc rw 0 0\n`;
    if (p === "/fake/cage.log") return `2026-11-17T09:00:01.000Z CAGE seq=9 born=${freshIso(200)} launcher=x run=r1 cwd=/x\n`;
    throw new Error("unexpected read " + p);
  },
  ...overrides,
});

test("full cage picture → LIVE", () => {
  const r = checkCagePresence(cageWorld());
  assert.equal(r.verdict, "LIVE");
  assert.equal(r.checks.pidNs, true);
  assert.equal(r.checks.homeTmpfs, true);
  assert.equal(r.checks.hookHeartbeat, true);
});

test("host picture (no env sig, host ns, no tmpfs, no log) → DEAD", () => {
  const r = checkCagePresence({
    env: {},
    hostHome: HOME,
    logPath: "/missing/cage.log",
    exists: () => false,
    read: (p) => {
      if (p === "/proc/self/status") return "NSpid:\t4139068\n";
      if (p === "/proc/mounts") return "ext4 / ext4 rw 0 0\n";
      throw new Error("ENOENT " + p);
    },
  });
  assert.equal(r.verdict, "DEAD");
  assert.equal(EXIT.DEAD, 1);
});

test("host picture with stale heartbeat → still DEAD", () => {
  const base = {
    env: {},
    hostHome: HOME,
    exists: () => false,
    read: (p) => {
      if (p === "/proc/self/status") return "NSpid:\t1\n";
      if (p === "/proc/mounts") return "ext4 / ext4 rw 0 0\n";
      return `2026-11-16T10:16:30.000Z CAGE seq=7 born=2026-11-16T10:16:30.382Z launcher=x run=r cwd=/x\n`;
    },
  };
  const r = checkCagePresence({ ...base, logPath: "/fake/old.log" });
  assert.equal(r.verdict, "DEAD");
});

test("forged env vars without kernel cage → never LIVE (DISPUTED at most)", () => {
  const r = checkCagePresence({
    env: { CAGE_BORN_AT: "x", LAUNCHER_STARTED_AT: "y" },
    hostHome: HOME,
    logPath: "/missing",
    exists: () => false,
    read: (p) => {
      if (p === "/proc/self/status") return "NSpid:\t9\n";
      if (p === "/proc/mounts") return "ext4 / ext4 rw 0 0\n";
      throw new Error("ENOENT");
    },
  });
  assert.equal(r.verdict, "DISPUTED");
});

test("cage kernel signals but hook heartbeat stopped → DISPUTED", () => {
  const r = checkCagePresence(
    cageWorld({
      read: (p) => {
        if (p === "/proc/self/status") return "NSpid:\t2\t1\n";
        if (p === "/proc/mounts") return `tmpfs ${HOME} tmpfs rw 0 0\n`;
        return "2026-01-01T00:00:00.000Z CAGE seq=1 born=2026-01-01T00:00:00.000Z launcher=x run=r cwd=/x\n";
      },
    }),
  );
  assert.equal(r.verdict, "DISPUTED");
});

test("host picture but fresh heartbeat → DISPUTED (contradiction, not silent DEAD)", () => {
  const r = checkCagePresence({
    env: {},
    hostHome: HOME,
    exists: () => false,
    read: (p) => {
      if (p === "/proc/self/status") return "NSpid:\t5\n";
      if (p === "/proc/mounts") return "ext4 / ext4 rw 0 0\n";
      return `x CAGE seq=3 born=${freshIso(100)} launcher=y run=z cwd=/w\n`;
    },
    logPath: "/fake/live.log",
  });
  assert.equal(r.verdict, "DISPUTED");
});
