import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkInside, ensureDir, inside, REPO_ROOT, stateDir, tempRoot } from "../kernel/surface/containment.mjs";

test("a path inside the state temp root is contained", () => {
  ensureDir(tempRoot());
  const dir = mkdtempSync(join(tempRoot(), "contained-"));
  const file = join(dir, "a.log");
  writeFileSync(file, "x");
  assert.equal(checkInside(file, [tempRoot()]).ok, true);
});

test("dot-dot cannot escape the root", () => {
  ensureDir(tempRoot());
  const escaped = join(tempRoot(), "..", "escaped.txt");
  assert.equal(checkInside(escaped, [tempRoot()]).ok, false);
});

test("a symlinked parent cannot escape the root", () => {
  ensureDir(tempRoot());
  const outside = mkdtempSync(join("/tmp", "ab2-outside-"));
  const link = join(tempRoot(), `link-${Date.now()}`);
  symlinkSync(outside, link);
  const target = join(link, "file.txt");
  assert.equal(inside(tempRoot(), target), false);
});

test("stateDir honours ABATHUR_STATE_DIR", () => {
  const before = process.env.ABATHUR_STATE_DIR;
  process.env.ABATHUR_STATE_DIR = "/tmp/ab2-state-probe";
  assert.equal(stateDir(), "/tmp/ab2-state-probe");
  if (before === undefined) delete process.env.ABATHUR_STATE_DIR;
  else process.env.ABATHUR_STATE_DIR = before;
});

test("rules generate refuses an output outside the repository and state dir", () => {
  const target = "/tmp/ab2-rules-outside.md";
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "cli", "abathur-v2.mjs"), "rules", "generate", "--out", target], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /OUTSIDE-ROOT/);
});
