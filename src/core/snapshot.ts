// snapshotCommit (todo 3): a READ-ONLY copy of a commit's tree for self-bench
// (todo 11). Materialized as a tiny standalone repo (init + fetch of the exact
// sha + detached checkout) so `git -C <snapshot> rev-parse HEAD^{tree}` answers
// with the tree sha, then every write bit is stripped (files 0o444/0o555, dirs
// 0o555). The copy is content-addressed and idempotent: re-snapshotting the
// same sha returns the cached dir after an integrity check.

import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { blocked } from "../exit.js";
import { git, tryGit } from "../util/git.js";
import { freezeTree, thawTree } from "../util/freeze.js";
import { gitOpts, requireSha, snapshotsDir } from "./genome-paths.js";
import type { GenomeRef, SnapshotHandle, WorktreeOptions } from "./genome-paths.js";

/** Thaw (if needed) then remove a frozen tree. Tolerates a vanished root. */
export async function removeFrozenTree(target: string): Promise<void> {
  try {
    await thawTree(target);
  } catch (cause) {
    // Already gone (ENOENT) — nothing to thaw; rm stays idempotent.
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
  }
  await rm(target, { recursive: true, force: true });
}

async function treeOf(cwd: string, rev: string, opts: WorktreeOptions): Promise<string | null> {
  const run = await tryGit(["rev-parse", rev], gitOpts(opts, cwd));
  return run.ok ? run.stdout.trim() : null;
}

/**
 * Copy `commitSha`'s tree into <cache>/<genomeFp>/snapshots/<sha> and freeze it.
 * Returns the snapshot path plus the commit's tree sha (verified equal to the
 * snapshot's checked-out tree before returning).
 */
export async function snapshotCommit(
  genome: GenomeRef,
  commitSha: string,
  opts: WorktreeOptions = {},
): Promise<SnapshotHandle> {
  const sha = requireSha(commitSha);
  const env = opts.env ?? process.env;
  const repo = path.resolve(genome.repoPath);
  const repoTree = await treeOf(repo, `${sha}^{tree}`, opts);
  if (repoTree === null) {
    blocked(`worktree: commit ${sha} is not reachable in genome repo ${repo}`);
  }
  const snap = path.join(snapshotsDir(env, genome), sha);

  if ((await stat(snap).catch(() => null)) !== null) {
    const cached = await treeOf(snap, "HEAD^{tree}", opts);
    if (cached === repoTree) {
      return { snapshotPath: snap, commitSha: sha, treeSha: repoTree };
    }
    await removeFrozenTree(snap); // half-written or corrupted — rebuild
  }

  await mkdir(path.dirname(snap), { recursive: true });
  await git(["init", "-q", snap], gitOpts(opts, repo));
  await git(["fetch", "-q", repo, sha], gitOpts(opts, snap));
  await git(["checkout", "-q", "--detach", "FETCH_HEAD"], gitOpts(opts, snap));
  const snapTree = await treeOf(snap, "HEAD^{tree}", opts);
  if (snapTree !== repoTree) {
    await removeFrozenTree(snap);
    blocked(`worktree: snapshot integrity mismatch at ${snap}`);
  }
  await freezeTree(snap);
  return { snapshotPath: snap, commitSha: sha, treeSha: repoTree };
}
