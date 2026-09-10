// src/util/git.ts acceptance pins (todo 3): array-argv execFile wrapper —
// timeout kill (fake binary proves the plumbing), error classification, tryGit.

import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import test from "node:test";

import { GitError, git, tryGit } from "../util/git.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "abathur-git-test-"));
}

test("git(): returns stdout/stderr for a successful run", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const r = await git(["init", "-q", "-b", "main", "."], { cwd: dir });
  assert.equal(r.stdout, "");
  const v = await git(["--version"], { cwd: dir });
  assert.match(v.stdout, /^git version \d+\.\d+/);
});

test("git(): classifies a non-zero exit as kind=failed with code and stderr", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    git(["rev-parse", "--verify", "refs/heads/nope"], { cwd: dir }),
    (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.equal(e.kind, "failed");
      assert.equal(typeof e.exitCode, "number");
      assert.notEqual(e.exitCode, 0);
      assert.ok(Array.isArray(e.args));
      return true;
    },
  );
});

test("tryGit(): plain non-zero exit becomes ok:false, not a rejection", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const r = await tryGit(["rev-parse", "--verify", "refs/heads/nope"], { cwd: dir });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "failed");
  const ok = await tryGit(["--version"], { cwd: dir });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.match(ok.stdout, /^git version/);
});

test("git(): spawn failure is kind=spawn", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(git(["status"], { bin: path.join(dir, "no-such-git") }), (e: unknown) => {
    assert.ok(e instanceof GitError);
    assert.equal(e.kind, "spawn");
    return true;
  });
});

// Adversarial class hung/stuck-git: a fake binary that never exits must be
// killed at timeoutMs (execFile plumbing proof — no real network hang needed).
test("git(): kills a hung invocation at timeoutMs instead of blocking forever", async (t) => {
  const dir = await tmp();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = path.join(dir, "hang-git");
  await writeFile(fake, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  await chmod(fake, 0o755);
  const started = Date.now();
  await assert.rejects(git(["whatever"], { bin: fake, timeoutMs: 300 }), (e: unknown) => {
    assert.ok(e instanceof GitError);
    assert.equal(e.kind, "timeout");
    assert.match(e.message, /timed out/);
    return true;
  });
  assert.ok(Date.now() - started < 5000, "hung git must be reaped quickly");
});
