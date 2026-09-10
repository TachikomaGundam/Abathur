// src/core/worktree.ts acceptance pins (todo 3) — plan AC line 98 verbatim:
// init → generation commit preserves the parent sha; two concurrent generations
// coexist; after cleanup `git -C <repo> status --porcelain` shows no abathur
// paths. Plus refusal/stale-state adversarial classes.

import assert from "node:assert/strict";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import test from "node:test";

import { ExitSignal } from "../exit.js";
import {
  cacheRoot,
  cleanupStale,
  fastForwardIncumbent,
  INCUMBENT_BRANCH,
  newGeneration,
  openGenome,
  sealGeneration,
} from "../core/worktree.js";
import { fixtureRepo, gitIn } from "./fixtures-wt.js";

async function expectExit(code: 1 | 2, pattern: RegExp, action: Promise<unknown>): Promise<void> {
  try {
    await action;
  } catch (e: unknown) {
    assert.ok(e instanceof ExitSignal, `expected ExitSignal, got ${String(e)}`);
    assert.equal(e.code, code);
    assert.match(e.message, pattern);
    return;
  }
  assert.fail(`expected rejection with exit ${code}`);
}

// ------------------------------------------------------------------ cacheRoot

test("cacheRoot: XDG scheme, ~/.cache fallback, junk XDG ignored", () => {
  assert.equal(cacheRoot({ XDG_CACHE_HOME: "/xdg" }), path.join("/xdg", "abathur", "worktrees"));
  assert.equal(cacheRoot({ HOME: "/home/u" }), path.join("/home/u", ".cache", "abathur", "worktrees"));
  assert.equal(
    cacheRoot({ XDG_CACHE_HOME: "relative/nope", HOME: "/home/u" }),
    path.join("/home/u", ".cache", "abathur", "worktrees"),
  );
  assert.equal(cacheRoot({}), path.join(os.homedir(), ".cache", "abathur", "worktrees"));
});

// ------------------------------------------------------------------ openGenome

test("openGenome: clean base reports head + branch, no dirtiness notices", async (t) => {
  const fx = await fixtureRepo(t);
  const opened = await openGenome(fx.repo, [], { env: fx.env });
  assert.equal(await realpath(opened.repoPath), await realpath(fx.repo));
  assert.equal(opened.headCommit, fx.head);
  assert.equal(opened.branch, "main");
  assert.deepEqual(opened.dirtyWorktree, []);
});

test("openGenome: dirty TARGET path refuses with exit 1; unrelated dirt becomes notices", async (t) => {
  const fx = await fixtureRepo(t);
  await writeFile(path.join(fx.repo, "bench", "run.sh"), "# drifted\n");
  await expectExit(1, /bench\/run\.sh/, openGenome(fx.repo, ["bench"], { env: fx.env }));
  await expectExit(
    1,
    /bench\/run\.sh/,
    openGenome(fx.repo, [path.join(fx.repo, "bench")], { env: fx.env }), // absolute target accepted
  );

  // untracked file inside the target scope is dirty too
  await rm(path.join(fx.repo, "bench", "run.sh"));
  await gitIn(fx.repo, "checkout", "-q", "--", "bench/run.sh");
  await writeFile(path.join(fx.repo, "bench", "scratch.tmp"), "u");
  await expectExit(1, /bench\/scratch\.tmp/, openGenome(fx.repo, ["bench"], { env: fx.env }));
  await rm(path.join(fx.repo, "bench", "scratch.tmp"));

  // same dirtiness OUTSIDE the target scope: not a refusal, a ledger notice
  await writeFile(path.join(fx.repo, "a.txt"), "dirty elsewhere\n");
  const opened = await openGenome(fx.repo, ["bench"], { env: fx.env });
  assert.equal(opened.dirtyWorktree.length, 1);
  const notice = opened.dirtyWorktree[0];
  assert.ok(notice !== undefined && notice.file === "a.txt" && notice.xy.length === 2);
});

test("openGenome: absent repo, non-git dir, empty repo and bare repo all block exit 1", async (t) => {
  const fx = await fixtureRepo(t);
  await expectExit(1, /not found/, openGenome(path.join(fx.root, "nope"), [], { env: fx.env }));
  const plain = path.join(fx.root, "plain");
  await mkdir(plain);
  await expectExit(1, /not a git repository/, openGenome(plain, [], { env: fx.env }));
  const empty = path.join(fx.root, "empty");
  await mkdir(empty);
  await gitIn(empty, "init", "-q", "-b", "main");
  await expectExit(1, /no commits/, openGenome(empty, [], { env: fx.env }));
  const bare = path.join(fx.root, "bare");
  await gitIn(fx.root, "clone", "-q", "--bare", fx.repo, bare);
  await expectExit(1, /bare/, openGenome(bare, [], { env: fx.env }));
});

// ------------------------------------------------- newGeneration + seal lifecycle

test("lifecycle AC: generation commit preserves parent sha; genome branch untouched", async (t) => {
  const fx = await fixtureRepo(t);
  const genome = { repoPath: fx.repo, genomeFp: fx.fp };
  const gen = await newGeneration(genome, fx.head, "g-100-alpha", { env: fx.env });

  assert.ok(gen.worktreePath.startsWith(path.join(fx.env.XDG_CACHE_HOME, "abathur", "worktrees", fx.fp)));
  assert.equal(gen.parentCommit, fx.head);
  assert.equal(await gitIn(gen.worktreePath, "rev-parse", "HEAD"), fx.head);
  assert.equal(await readFileStr(path.join(gen.worktreePath, "bench", "run.sh")), "echo bench\n");

  await writeFile(path.join(gen.worktreePath, "mutant.txt"), "improved\n");
  const sealed = await sealGeneration(genome, "g-100-alpha", "gen: tune bench mutant", {
    env: fx.env,
  });
  assert.match(sealed.commitSha, /^[0-9a-f]{40}$/);
  assert.match(sealed.treeSha, /^[0-9a-f]{40}$/);
  // parent sha preserved through the seal
  assert.equal(await gitIn(fx.repo, "rev-parse", `${sealed.commitSha}^`), fx.head);
  assert.equal(await gitIn(fx.repo, "rev-parse", `${sealed.commitSha}^{tree}`), sealed.treeSha);
  // the genome repo's checked-out branch was NEVER touched
  assert.equal(await gitIn(fx.repo, "rev-parse", "HEAD"), fx.head);
  assert.equal(await gitIn(fx.repo, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(await gitIn(fx.repo, "status", "--porcelain"), "");
});

test("AC: two concurrent generations' worktrees coexist; chain from sealed sha", async (t) => {
  const fx = await fixtureRepo(t);
  const genome = { repoPath: fx.repo, genomeFp: fx.fp };
  const a = await newGeneration(genome, fx.head, "g-100-a", { env: fx.env });
  const b = await newGeneration(genome, fx.head, "g-100-b", { env: fx.env });
  assert.notEqual(a.worktreePath, b.worktreePath);

  await writeFile(path.join(a.worktreePath, "x.txt"), "a");
  const sealedA = await sealGeneration(genome, "g-100-a", "gen a", { env: fx.env });
  // sealedA lives only in the shared object db via a detached worktree
  assert.equal(await gitIn(b.worktreePath, "rev-parse", "HEAD"), fx.head); // untouched
  const c = await newGeneration(genome, sealedA.commitSha, "g-101-c", { env: fx.env });
  assert.equal(c.parentCommit, sealedA.commitSha);
  assert.equal((await stat(path.join(c.worktreePath, "x.txt"))).isFile(), true);
  const listed = await gitIn(fx.repo, "worktree", "list", "--porcelain");
  // main + a + b + c — all four registry entries coexist
  assert.equal(listed.split("\n").filter((l) => l.startsWith("worktree ")).length, 4);
});

test("sealGeneration: unknown generation and no-change seal both block exit 1", async (t) => {
  const fx = await fixtureRepo(t);
  const genome = { repoPath: fx.repo, genomeFp: fx.fp };
  await expectExit(1, /not found/, sealGeneration(genome, "g-nope", "ghost", { env: fx.env }));
  await newGeneration(genome, fx.head, "g-100-quiet", { env: fx.env });
  await expectExit(1, /nothing/, sealGeneration(genome, "g-100-quiet", "no changes", { env: fx.env }));
});

// ------------------------------------------------------------------ cleanupStale

test("cleanupStale AC: prunes generations+snapshots, survives double-run and dead registry entries", async (t) => {
  const fx = await fixtureRepo(t);
  const genome = { repoPath: fx.repo, genomeFp: fx.fp };
  const gen = await newGeneration(genome, fx.head, "g-100-x", { env: fx.env });
  await writeFile(path.join(gen.worktreePath, "x.txt"), "x");
  await sealGeneration(genome, "g-100-x", "gen x", { env: fx.env });
  const dead = await newGeneration(genome, fx.head, "g-100-dead", { env: fx.env });
  await rm(dead.worktreePath, { recursive: true, force: true }); // crash simulation: dir gone, registry alive

  const first = await cleanupStale(genome, 0, { env: fx.env });
  assert.ok(first.removed.includes(gen.worktreePath));
  assert.equal(first.kept.length, 0);
  // idempotent second run (stale-state adversarial class)
  const second = await cleanupStale(genome, 0, { env: fx.env });
  assert.deepEqual(second.removed, []);
  // dead registry entry pruned: only the main worktree remains, re-add with same id works
  const listed = await gitIn(fx.repo, "worktree", "list", "--porcelain");
  assert.equal(listed.split("\n").filter((l) => l.startsWith("worktree ")).length, 1);
  const readd = await newGeneration(genome, fx.head, "g-100-dead", { env: fx.env });
  assert.equal(await gitIn(readd.worktreePath, "rev-parse", "HEAD"), fx.head);

  const report = await cleanupStale(genome, 0, { env: fx.env });
  assert.ok(report.removed.length >= 1);
  // AC verbatim: no abathur paths in the genome repo status, ever
  assert.equal(await gitIn(fx.repo, "status", "--porcelain"), "");
  await assert.rejects(stat(path.join(fx.env.XDG_CACHE_HOME, "abathur", "worktrees", fx.fp, "g-100-x")));
});

test("cleanupStale: fresh generations are KEPT when olderThanDays does not cover them", async (t) => {
  const fx = await fixtureRepo(t);
  const genome = { repoPath: fx.repo, genomeFp: fx.fp };
  const gen = await newGeneration(genome, fx.head, "g-100-keep", { env: fx.env });
  const r = await cleanupStale(genome, 7, { env: fx.env });
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.kept, [gen.worktreePath]);
});

test("cleanupStale: negative/NaN olderThanDays is a tool error (exit 2)", async (t) => {
  const fx = await fixtureRepo(t);
  const genome = { repoPath: fx.repo, genomeFp: fx.fp };
  await expectExit(2, /olderThanDays/, cleanupStale(genome, Number.NaN, { env: fx.env }));
  await expectExit(2, /olderThanDays/, cleanupStale(genome, -1, { env: fx.env }));
});

// ---------------------------------------------------------- incumbent discipline

test("fastForwardIncumbent: creates, ff-forwards, refuses rewind and checked-out branch (never force)", async (t) => {
  const fx = await fixtureRepo(t);
  const genome = { repoPath: fx.repo, genomeFp: fx.fp };
  const gen = await newGeneration(genome, fx.head, "g-100-p", { env: fx.env });
  await writeFile(path.join(gen.worktreePath, "promote.txt"), "p");
  const sealed = await sealGeneration(genome, "g-100-p", "gen p", { env: fx.env });

  const made = await fastForwardIncumbent(genome, sealed.commitSha, { env: fx.env });
  assert.equal(made.fromSha, null);
  assert.equal(made.branch, INCUMBENT_BRANCH);
  assert.equal(await gitIn(fx.repo, "rev-parse", INCUMBENT_BRANCH), sealed.commitSha);

  // no-op when already there
  const noop = await fastForwardIncumbent(genome, sealed.commitSha, { env: fx.env });
  assert.equal(noop.fromSha, sealed.commitSha);

  // rewind is a refusal, and the ref does not move
  await expectExit(1, /ancestor/, fastForwardIncumbent(genome, fx.head, { env: fx.env }));
  assert.equal(await gitIn(fx.repo, "rev-parse", INCUMBENT_BRANCH), sealed.commitSha);

  // forward again works
  const gen2 = await newGeneration(genome, sealed.commitSha, "g-101-q", { env: fx.env });
  await writeFile(path.join(gen2.worktreePath, "more.txt"), "q");
  const sealed2 = await sealGeneration(genome, "g-101-q", "gen q", { env: fx.env });
  const moved = await fastForwardIncumbent(genome, sealed2.commitSha, { env: fx.env });
  assert.equal(moved.fromSha, sealed.commitSha);
  assert.equal(moved.toSha, sealed2.commitSha);

  // checked-out incumbent must not be moved while in use
  await gitIn(fx.repo, "checkout", "-q", INCUMBENT_BRANCH);
  await expectExit(1, /checked out/, fastForwardIncumbent(genome, fx.head, { env: fx.env }));
});

// ---------------------------------------------------------------- unsafe inputs

test("unsafe genomeFp/genId/parentCommit are tool errors (exit 2), never spawned to git", async (t) => {
  const fx = await fixtureRepo(t);
  await expectExit(2, /fingerprint/, newGeneration({ repoPath: fx.repo, genomeFp: "../evil" }, fx.head, "g-1", { env: fx.env }));
  await expectExit(2, /generation id/, newGeneration({ repoPath: fx.repo, genomeFp: "ok" }, fx.head, "g 1;rm", { env: fx.env }));
  await expectExit(2, /generation id/, newGeneration({ repoPath: fx.repo, genomeFp: "ok" }, fx.head, "-x", { env: fx.env }));
  await expectExit(2, /revision/, newGeneration({ repoPath: fx.repo, genomeFp: "ok" }, "--help", "g-1", { env: fx.env }));
});

async function readFileStr(p: string): Promise<string> {
  return readFile(p, "utf8");
}
