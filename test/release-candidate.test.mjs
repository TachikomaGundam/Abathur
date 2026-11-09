import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../kernel/surface/index.mjs";

const SCRIPT = join(REPO_ROOT, "scripts", "release-candidate.mjs");

test("release candidate refuses to run without a commit", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--commit is required/);
});

test("release candidate refuses a commit that does not resolve", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--commit", "does-not-exist"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RELEASE-CANDIDATE/);
});

test("release candidate refuses an output directory outside evidence", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--commit", "HEAD", "--out", "/tmp/not-evidence"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /evidence root/);
});

test("release candidate creates its temp root and packs a named commit", () => {
  const state = mkdtempSync(join(tmpdir(), "abathur-rc-state-"));
  try {
    const out = join(state, "evidence");
    const result = spawnSync(process.execPath, [SCRIPT, "--commit", "HEAD", "--out", out], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, ABATHUR_STATE_DIR: state },
    });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout.trim());
    assert.equal(receipt.ok, true);
    assert.equal(receipt.files > 0, true);
    assert.match(receipt.sha256, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
