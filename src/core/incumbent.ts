// Fast-forward-only incumbent promotion (todo 3 helper; todo 10 consumes it).
// The ref may only move FORWARD: `update-ref <ref> <new> <old>` compare-and-swap
// refuses a rewind or a concurrent move by exiting non-zero — abathur never
// rewrites history and never updates a ref while the branch is checked out.

import path from "node:path";

import { blocked } from "../exit.js";
import { tryGit } from "../util/git.js";
import { gitOpts, requireSha } from "./genome-paths.js";
import type { GenomeRef, WorktreeOptions } from "./genome-paths.js";

/** Promotion branch — moved by fast-forward CAS only (todo 10), created if absent. */
export const INCUMBENT_BRANCH = "abathur/incumbent";

export interface FastForwardResult {
  readonly branch: typeof INCUMBENT_BRANCH;
  /** null when the branch did not exist yet. */
  readonly fromSha: string | null;
  readonly toSha: string;
}

/**
 * Move INCUMBENT_BRANCH to `commitSha` iff it is a descendant of the current
 * tip (or the branch is absent and gets created). A no-op when already there.
 */
export async function fastForwardIncumbent(
  genome: GenomeRef,
  commitSha: string,
  opts: WorktreeOptions = {},
): Promise<FastForwardResult> {
  const sha = requireSha(commitSha);
  const gopts = gitOpts(opts, path.resolve(genome.repoPath));

  const current = await tryGit(["symbolic-ref", "--short", "-q", "HEAD"], gopts);
  if (current.ok && current.stdout.trim() === INCUMBENT_BRANCH) {
    blocked(
      `worktree: ${INCUMBENT_BRANCH} is checked out in ${gopts.cwd} — promotion needs it idle`,
      "switch the genome repo to another branch before promoting",
    );
  }

  const ref = `refs/heads/${INCUMBENT_BRANCH}`;
  const existing = await tryGit(["rev-parse", "--verify", "-q", ref], gopts);
  if (!existing.ok) {
    const created = await tryGit(["branch", INCUMBENT_BRANCH, sha], gopts);
    if (!created.ok) {
      const why = created.error.stderr.trim().split("\n")[0] ?? created.error.message;
      blocked(
        `worktree: cannot create ${INCUMBENT_BRANCH} at ${sha}: ${why}`,
        "is the commit reachable in the genome repo?",
      );
    }
    return { branch: INCUMBENT_BRANCH, fromSha: null, toSha: sha };
  }
  const fromSha = existing.stdout.trim();
  if (fromSha === sha) return { branch: INCUMBENT_BRANCH, fromSha, toSha: sha };

  const ancestor = await tryGit(["merge-base", "--is-ancestor", fromSha, sha], gopts);
  if (!ancestor.ok) {
    blocked(
      `worktree: ${INCUMBENT_BRANCH} (${fromSha.slice(0, 12)}) is not an ancestor of ${sha} — only fast-forward moves are allowed`,
      "point the promotion at a descendant of the current incumbent",
    );
  }
  // CAS: the old-value argument makes this a pure fast-forward — if the ref
  // moved concurrently, update-ref exits non-zero instead of clobbering it.
  const moved = await tryGit(["update-ref", ref, sha, fromSha], gopts);
  if (!moved.ok) {
    blocked(
      `worktree: ${INCUMBENT_BRANCH} moved concurrently (expected ${fromSha}) — rerun the promotion`,
    );
  }
  return { branch: INCUMBENT_BRANCH, fromSha, toSha: sha };
}
