// snapshotCommit + freeze/thaw acceptance pins (todo 3, plan AC line 98):
// the snapshot dir is a chmod-restricted read-only copy and `git -C <snap>`
// reports the exact tree sha of the snapshotted commit.

import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import test from "node:test";

import { newGeneration, sealGeneration, snapshotCommit } from "../core/worktree.js";
import { freezeTree, thawTree } from "../util/freeze.js";
import { fixtureRepo, gitIn } from "./fixtures-wt.js";

function isRoot(): boolean {
  return process.getuid !== undefined && process.getuid() === 0;
}

// ------------------------------------------------------------------ freeze/thaw

test("freezeTree/thawTree: strip then restore write bits, exec bit preserved, symlinks skipped", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "abathur-freeze-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "plain.txt"), "x\n");
  await writeFile(path.join(root, "prog.sh"), "#!/bin/sh\n", { mode: 0o755 });
  await mkdir(path.join(root, "sub", "deep"), { recursive: true });
  await writeFile(path.join(root, "sub", "deep", "f.bin"), "y");
  await symlink(path.join(root, "plain.txt"), path.join(root, "link.txt"));

  await freezeTree(root);
  assert.equal((await stat(path.join(root, "plain.txt"))).mode & 0o222, 0);
  assert.equal((await stat(path.join(root, "sub"))).mode & 0o7777, 0o555);
  assert.equal(
    (await stat(path.join(root, "prog.sh"))).mode & 0o7777,
    0o555,
    "exec bit survives, write bits stripped",
  );
  assert.equal((await lstat(path.join(root, "link.txt"))).isSymbolicLink(), true);

  await thawTree(root);
  assert.notEqual((await stat(path.join(root, "plain.txt"))).mode & 0o200, 0);
  assert.notEqual((await stat(path.join(root, "sub"))).mode & 0o200, 0);
  await writeFile(path.join(root, "sub", "late.txt"), "writable again");
});

// --------------------------------------------------------------- snapshotCommit

test("snapshotCommit: read-only copy whose git tree sha matches the commit exactly", async (t) => {
  const fx = await fixtureRepo(t, "abathur-snap-");
  const genome = { repoPath: fx.repo, genomeFp: fx.fp };

  const snap = await snapshotCommit(genome, fx.head, { env: fx.env });
  const expectedTree = await gitIn(fx.repo, "rev-parse", `${fx.head}^{tree}`);
  assert.equal(snap.treeSha, expectedTree);
  // AC verbatim: `git -C <snapshot>` reports the exact tree sha.
  assert.equal(await gitIn(snap.snapshotPath, "rev-parse", "HEAD^{tree}"), expectedTree);
  // real copy of the tree content, under the injected XDG cache scheme
  assert.equal(await readFile(path.join(snap.snapshotPath, "a.txt"), "utf8"), "first\n");
  assert.ok(
    snap.snapshotPath.startsWith(
      path.join(fx.env.XDG_CACHE_HOME, "abathur", "worktrees", fx.fp, "snapshots"),
    ),
  );

  // second call: content-addressed cache hit, same path + tree
  const again = await snapshotCommit(genome, fx.head, { env: fx.env });
  assert.equal(again.snapshotPath, snap.snapshotPath);
  assert.equal(again.treeSha, expectedTree);
});

test("snapshotCommit: files are mode-restricted; write attempts fail EACCES", async (t) => {
  const fx = await fixtureRepo(t, "abathur-snap-");
  const snap = await snapshotCommit({ repoPath: fx.repo, genomeFp: fx.fp }, fx.head, {
    env: fx.env,
  });
  const f = path.join(snap.snapshotPath, "a.txt");
  assert.equal((await stat(f)).mode & 0o222, 0);
  assert.equal((await stat(snap.snapshotPath)).mode & 0o7777, 0o555);
  if (isRoot()) {
    // our env is the non-root 'lab' user (uid 1000) so the probes below really run;
    // this skip branch exists only for hypothetical root CI (noted in evidence).
    t.skip("running as euid 0 — mode bits do not deny writes");
    return;
  }
  const expectAcces = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === "EACCES";
  await assert.rejects(open(f, "w"), expectAcces);
  await assert.rejects(mkdir(path.join(snap.snapshotPath, "newdir")), expectAcces);
  // still readable + git-introspectable while frozen
  assert.match(await readFile(f, "utf8"), /first/);
  assert.match(await gitIn(snap.snapshotPath, "rev-parse", "HEAD^{tree}"), /^[0-9a-f]{40}$/);
});

test("snapshotCommit: snapshots a branch-unreachable sealed commit (todo 11 self-bench flow)", async (t) => {
  const fx = await fixtureRepo(t, "abathur-snap-");
  const genome = { repoPath: fx.repo, genomeFp: fx.fp };
  const gen = await newGeneration(genome, fx.head, "g-200-seal", { env: fx.env });
  await writeFile(path.join(gen.worktreePath, "mutant.txt"), "m\n");
  const sealed = await sealGeneration(genome, "g-200-seal", "gen: mutant", { env: fx.env });
  // unreachable from any branch in the genome repo — snapshot must still materialise it
  const snap = await snapshotCommit(genome, sealed.commitSha, { env: fx.env });
  assert.equal(snap.treeSha, sealed.treeSha);
  assert.match(await readFile(path.join(snap.snapshotPath, "mutant.txt"), "utf8"), /m/);
});

test("snapshotCommit: non-hex commitSha is a tool error (exit 2)", async (t) => {
  const fx = await fixtureRepo(t, "abathur-snap-");
  await assert.rejects(
    snapshotCommit({ repoPath: fx.repo, genomeFp: "ok_fp" }, "main", { env: fx.env }),
    (e: unknown) => (e as { code?: number }).code === 2,
  );
});
