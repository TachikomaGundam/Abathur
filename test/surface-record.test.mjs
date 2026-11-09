import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRunRecord, readRunRecord, reconcileRuns, runsDir } from "../kernel/surface/record.mjs";
import { tempRoot } from "../kernel/surface/containment.mjs";
import { REPO_ROOT } from "../kernel/surface/index.mjs";
import { buildArgv } from "../.opencode/plugins/sandbox-bash.js";

function base() {
  return mkdtempSync(join(tmpdir(), "ab2-record-"));
}

test("a launcher record round-trips and names its root", () => {
  const root = base();
  const { path, record } = createRunRecord({ surface: "E1", root });
  const read = readRunRecord(path, { ABATHUR_RUN_ID: record.id });
  assert.equal(read.ok, true);
  assert.equal(read.record.root, root);
  assert.equal(read.record.origin, "launcher");
});

test("a mismatched run id is refused", () => {
  const { path } = createRunRecord({ surface: "E1", root: base() });
  const read = readRunRecord(path, { ABATHUR_RUN_ID: "run-other" });
  assert.equal(read.ok, false);
  assert.equal(read.code, "RUN-RECORD-MISMATCH");
});

test("an expired record is refused", () => {
  const root = base();
  const { path, record } = createRunRecord({ surface: "E1", root, ttlMs: -1 });
  const read = readRunRecord(path, { ABATHUR_RUN_ID: record.id });
  assert.equal(read.ok, false);
  assert.equal(read.code, "RUN-RECORD-EXPIRED");
});

test("a record outside the state runs directory is refused", () => {
  const fake = join(base(), "fake.json");
  const id = "run-fake-1";
  writeFileSync(
    fake,
    JSON.stringify({
      id,
      surface: "E1",
      root: REPO_ROOT,
      origin: "launcher",
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      pid: process.pid,
      leases: [],
    }),
  );
  const read = readRunRecord(fake, { ABATHUR_RUN_ID: id });
  assert.equal(read.ok, false);
  assert.equal(read.code, "RUN-RECORD-UNTRUSTED");
});

test("a record inside the runs directory with a non-launcher origin is refused", () => {
  const id = `run-${Date.now()}-origin`;
  const path = join(runsDir(), `${id}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      id,
      surface: "E1",
      root: REPO_ROOT,
      origin: "test",
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      pid: process.pid,
      leases: [],
    }),
  );
  const read = readRunRecord(path, { ABATHUR_RUN_ID: id });
  assert.equal(read.ok, false);
  assert.equal(read.code, "RUN-RECORD-UNTRUSTED");
  rmSync(path, { force: true });
});

test("a record whose filename does not match its id is refused", () => {
  const id = `run-${Date.now()}-basename`;
  const path = join(runsDir(), `other-${id}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      id,
      surface: "E1",
      root: REPO_ROOT,
      origin: "launcher",
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      pid: process.pid,
      leases: [],
    }),
  );
  const read = readRunRecord(path, { ABATHUR_RUN_ID: id });
  assert.equal(read.ok, false);
  assert.equal(read.code, "RUN-RECORD-UNTRUSTED");
  rmSync(path, { force: true });
});

test("a record without a run id is refused", () => {
  const { path } = createRunRecord({ surface: "E1", root: base() });
  const read = readRunRecord(path, {});
  assert.equal(read.ok, false);
  assert.equal(read.code, "RUN-RECORD-MISMATCH");
});

test("a malformed record is refused", () => {
  const path = join(base(), "bad.json");
  writeFileSync(path, "{not json");
  const read = readRunRecord(path, {});
  assert.equal(read.ok, false);
  assert.equal(read.code, "RUN-RECORD-MALFORMED");
});

test("the cage receives the record read-only", () => {
  const ws = base();
  const { path, record } = createRunRecord({ surface: "E1", root: ws });
  const argv = buildArgv({ workspace: ws, cmd: "true", bornAt: "t0", launcherStartedAt: "t1", runRecordPath: path, runId: record.id });
  const i = argv.indexOf(path);
  assert.ok(i > 0 && argv[i - 1] === "--ro-bind");
  const rec = argv.indexOf("ABATHUR_RUN_RECORD");
  assert.ok(rec > 0 && argv[rec - 1] === "--setenv" && argv[rec + 1] === "/abathur-run.json");
  const id = argv.indexOf("ABATHUR_RUN_ID");
  assert.ok(id > 0 && argv[id - 1] === "--setenv" && argv[id + 1] === record.id);
});

test("surface show reports the launcher record", () => {
  const ws = base();
  const { path, record } = createRunRecord({ surface: "E1", root: ws });
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "cli", "abathur-v2.mjs"), "surface", "show"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ABATHUR_RUN_RECORD: path, ABATHUR_RUN_ID: record.id },
  });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.record.root, ws);
});

test("surface check refuses a target outside the recorded root", () => {
  const ws = base();
  const { path, record } = createRunRecord({ surface: "E1", root: ws });
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "cli", "abathur-v2.mjs"), "surface", "check", join(tmpdir(), "abathur-not-allowed")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ABATHUR_RUN_RECORD: path, ABATHUR_RUN_ID: record.id },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /OUTSIDE-ROOT/);
});

test("reconciler closes a dead expired run and removes its temp lease", () => {
  const lease = join(tempRoot(), `run-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(lease, { recursive: true });
  writeFileSync(join(lease, "payload"), "x");
  const { path } = createRunRecord({ root: base(), ttlMs: -1, pid: 2_000_000_000, leases: [lease] });
  const report = reconcileRuns({ now: Date.now() });
  assert.ok(report.closed >= 1);
  assert.equal(existsSync(lease), false);
  assert.equal(existsSync(path), false);
});

test("reconciler keeps a live run even after its ttl", () => {
  const { path } = createRunRecord({ root: base(), ttlMs: -1, pid: process.pid });
  const report = reconcileRuns({ now: Date.now() });
  assert.ok(report.kept >= 1);
  assert.equal(existsSync(path), true);
  rmSync(path, { force: true });
});

test("reconciler refuses a lease outside the temp root and reports orphans", () => {
  const outside = join(base(), "not-owned");
  mkdirSync(outside, { recursive: true });
  const id = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(
    join(runsDir(), `${id}.json`),
    `${JSON.stringify({
      id,
      surface: "E1",
      root: "/tmp",
      origin: "test",
      pid: 2_000_000_000,
      leases: [outside],
      issued_at: new Date(0).toISOString(),
      expires_at: new Date(0).toISOString(),
    })}\n`,
  );
  const orphan = join(tempRoot(), `run-orphan-${Date.now()}`);
  mkdirSync(orphan, { recursive: true });
  const report = reconcileRuns({ now: Date.now() });
  assert.ok(report.refused_leases >= 1);
  assert.equal(existsSync(outside), true);
  assert.ok(report.orphans.includes(orphan));
  assert.equal(existsSync(orphan), true);
  rmSync(orphan, { recursive: true, force: true });
});
