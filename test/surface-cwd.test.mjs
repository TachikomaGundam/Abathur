import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/abathur-v2.mjs", import.meta.url));

function run(cwd) {
  return spawnSync(process.execPath, [CLI, "surface", "show"], { cwd, encoding: "utf8" });
}

test("the direct surface root follows the repository, not the package directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "abathur-cwd-"));
  try {
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, "kernel"));
    const nested = join(dir, "kernel");
    const result = run(nested);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.record.surface, "E1");
    assert.equal(payload.record.root, dir);
    assert.equal(payload.record.origin, "direct");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("outside a repository E1 is not established", () => {
  const dir = mkdtempSync(join(tmpdir(), "abathur-norepo-"));
  try {
    const result = run(dir);
    assert.equal(result.status, 2, result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.code, "E1-NO-REPO");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
