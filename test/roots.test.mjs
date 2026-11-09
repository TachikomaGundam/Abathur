import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot } from "../kernel/surface/containment.mjs";
import { REPO_ROOT as SURFACE_ROOT } from "../kernel/surface/index.mjs";
import { REPO_ROOT as LANE_ROOT } from "../kernel/lane/index.mjs";

test("surface and lane share one repository-root authority", () => {
  assert.equal(SURFACE_ROOT, LANE_ROOT);
  assert.equal(SURFACE_ROOT, findRepoRoot(process.cwd()));
});

test("findRepoRoot detects a nested directory and rejects a non-repository", () => {
  assert.equal(findRepoRoot(join(SURFACE_ROOT, "kernel")), SURFACE_ROOT);
  const outside = mkdtempSync(join(tmpdir(), "abathur-no-repo-"));
  try {
    assert.equal(findRepoRoot(outside), null);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
