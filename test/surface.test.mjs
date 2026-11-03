import test from "node:test";
import assert from "node:assert/strict";
import { assertSurface, humanGatePrescription } from "../kernel/surface/index.mjs";

test("an E1 write inside the worktree is allowed", () => {
  const result = assertSurface({ op: "write", surface: "E1", path: "/home/lab/workspace/harness/Abathur-v2/src/a.mjs" });
  assert.equal(result.rc, 0);
  assert.equal(result.code, "SURFACE-OK");
});

test("an E1 write outside the worktree is denied", () => {
  const result = assertSurface({ op: "write", surface: "E1", path: "/etc/passwd" });
  assert.equal(result.rc, 1);
  assert.equal(result.code, "SURFACE-DENIED");
});

test("E2 and E3 writes are human gates", () => {
  assert.equal(assertSurface({ op: "write", surface: "E2", path: "/usr/lib/a" }).code, "HUMAN-GATE");
  assert.equal(assertSurface({ op: "write", surface: "E3", path: "/remote/a" }).code, "HUMAN-GATE");
});

test("promote never executes", () => {
  const result = assertSurface({ op: "promote", surface: "E1", path: "/home/lab/workspace/harness/Abathur-v2" });
  assert.equal(result.rc, 1);
  assert.equal(result.code, "HUMAN-GATE");
  assert.match(result.detail, /HUMAN-GATE promote/);
});

test("prescriptions carry an absolute path", () => {
  const text = humanGatePrescription("promote", "/home/lab/workspace/harness/Abathur-v2");
  assert.ok(text.includes("/home/lab/workspace/harness/Abathur-v2"));
  assert.ok(text.includes("terminal"));
});
