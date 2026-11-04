import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRunRecord, readRunRecord } from "../kernel/surface/record.mjs";
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
  const { path } = createRunRecord({ surface: "E1", root, ttlMs: -1 });
  const read = readRunRecord(path, {});
  assert.equal(read.ok, false);
  assert.equal(read.code, "RUN-RECORD-EXPIRED");
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
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "cli", "abathur-v2.mjs"), "surface", "check", "/home/lab/not-allowed"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ABATHUR_RUN_RECORD: path, ABATHUR_RUN_ID: record.id },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /OUTSIDE-ROOT/);
});
