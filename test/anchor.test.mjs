import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { anchor, mirrorGeneration } from "../kernel/evidence/anchor.mjs";

test("an unconfigured anchor fails closed with rc=2", () => {
  const result = anchor("deadbeef", {});
  assert.equal(result.rc, 2);
  assert.equal(result.code, "ANCHOR UNDISPATCHABLE");
});

test("the injected anchor receives the tail hash", () => {
  const result = anchor("deadbeef", { ABATHUR_ANCHOR_CMD: "read tail; test \"$tail\" = deadbeef" });
  assert.equal(result.rc, 0);
  assert.equal(result.code, "ANCHOR-OK");
});

test("a failing anchor surfaces its rc", () => {
  const result = anchor("x", { ABATHUR_ANCHOR_CMD: "exit 3" });
  assert.equal(result.rc, 3);
  assert.equal(result.code, "ANCHOR-FAILED");
});

test("the mirror manifest is deterministic", () => {
  const root = mkdtempSync(join(tmpdir(), "ab2-mirror-"));
  writeFileSync(join(root, "a.txt"), "a");
  writeFileSync(join(root, "b.txt"), "b");
  const first = mirrorGeneration(root);
  const second = mirrorGeneration(root);
  assert.equal(first.count, 2);
  assert.equal(first.digest, second.digest);
  assert.match(first.digest, /^[0-9a-f]{64}$/);
});
