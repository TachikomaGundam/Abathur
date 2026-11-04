import test from "node:test";
import assert from "node:assert/strict";
import { assertSurface, humanGatePrescription, REPO_ROOT, SURFACES } from "../kernel/surface/index.mjs";

const E1_ROOT = SURFACES.E1.writes[0].replace(/\/$/, "");

test("E1 is the current repository, not a stale tree name", () => {
  assert.equal(E1_ROOT, REPO_ROOT);
  assert.equal(assertSurface({ op: "write", surface: "E1", path: `${E1_ROOT}/kernel/x.mjs` }).code, "SURFACE-OK");
});

test("an E1 write outside the repository is denied", () => {
  assert.equal(assertSurface({ op: "write", surface: "E1", path: "/etc/passwd" }).code, "SURFACE-DENIED");
  assert.equal(assertSurface({ op: "write", surface: "E1", path: "/home/lab/workspace/other/x" }).code, "SURFACE-DENIED");
});

test("a write under the removed second tree is denied", () => {
  const result = assertSurface({ op: "write", surface: "E1", path: "/home/lab/workspace/harness/Abathur-v2/x" });
  assert.equal(result.code, "SURFACE-DENIED");
});

test("dot-dot cannot pass as an E1 path", () => {
  const result = assertSurface({ op: "write", surface: "E1", path: `${E1_ROOT}/../etc/passwd` });
  assert.equal(result.code, "SURFACE-DENIED");
});

test("the retired Q release checkout is not a declared surface", () => {
  assert.equal(SURFACES.Q, undefined);
});

test("E2 and E3 writes are human gates", () => {
  assert.equal(assertSurface({ op: "write", surface: "E2", path: "/usr/lib/a" }).code, "HUMAN-GATE");
  assert.equal(assertSurface({ op: "write", surface: "E3", path: "/remote/a" }).code, "HUMAN-GATE");
});

test("promote never executes", () => {
  const result = assertSurface({ op: "promote", surface: "E1", path: E1_ROOT });
  assert.equal(result.rc, 1);
  assert.equal(result.code, "HUMAN-GATE");
  assert.match(result.detail, /HUMAN-GATE promote/);
});

test("prescriptions carry an absolute path", () => {
  const text = humanGatePrescription("promote", E1_ROOT);
  assert.ok(text.includes(E1_ROOT));
  assert.ok(text.includes("terminal"));
});
