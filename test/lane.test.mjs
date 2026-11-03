import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LANES, REPO_ROOT, attributeWrite, foreignWrite } from "../kernel/lane/index.mjs";

const ok = {
  path: `${REPO_ROOT}/kernel/lane/index.mjs`,
  actor: "abathur",
  ts: "2026-11-03T00:00:00Z",
  identity: { status: "ATTRIBUTED" },
};

test("the lane registry is the current repository and only one lane", () => {
  assert.equal(DEFAULT_LANES.length, 1);
  assert.equal(DEFAULT_LANES[0].repo, REPO_ROOT);
  assert.equal(DEFAULT_LANES[0].lane, "abathur");
});

test("a write with full evidence is attributed", () => {
  const result = attributeWrite(DEFAULT_LANES, ok);
  assert.equal(result.status, "ATTRIBUTED");
  assert.equal(result.lane, "abathur");
});

test("a write without identity evidence stays disputed", () => {
  const result = attributeWrite(DEFAULT_LANES, { ...ok, identity: { status: "UNATTRIBUTED" } });
  assert.equal(result.status, "DISPUTED");
});

test("a write outside every lane is disputed, never blamed on a seat", () => {
  const result = attributeWrite(DEFAULT_LANES, { ...ok, path: "/tmp/outside" });
  assert.equal(result.status, "DISPUTED");
  assert.equal(result.seat, undefined);
});

test("foreign writes are reported by path", () => {
  assert.equal(foreignWrite(DEFAULT_LANES, `${REPO_ROOT}/a`).foreign, false);
  assert.equal(foreignWrite(DEFAULT_LANES, "/home/lab/workspace/harness/PCB-Agent/a").foreign, true);
  assert.equal(foreignWrite(DEFAULT_LANES, "/home/lab/workspace/harness/Abathur-v2/a").foreign, true);
});
