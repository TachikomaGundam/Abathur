// Git worktree generation store (todo 3).
//
// Cache-path scheme:
//   $XDG_CACHE_HOME/abathur/worktrees/<genomeFp>/<genId>        generation worktrees
//   $XDG_CACHE_HOME/abathur/worktrees/<genomeFp>/snapshots/<sha> read-only commit copies
//   fallback root when XDG_CACHE_HOME is unset/empty/relative: ~/.cache
//
// Invariants upheld here:
//   - generations live in detached worktrees under the cache root — abathur NEVER
//     commits into the genome repo's checked-out branch and never mutates the
//     user's main worktree (dirty target paths are a refusal, not a fix);
//   - no push and no ref update without a compare-and-swap old-value here —
//     abathur/incumbent moves fast-forward-only (todo 10 consumes that helper);
//   - every git call goes through src/util/git.ts (execFile array argv, timeout).

import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { blocked, cannotAnswer } from "../exit.js";
import { git, tryGit } from "../util/git.js";
import {
  generationPath,
  genomeDir,
  gitOpts,
  requireRev,
  SNAPSHOTS_DIR,
} from "./genome-paths.js";
import type { GenomeRef, WorktreeOptions } from "./genome-paths.js";
import { removeFrozenTree } from "./snapshot.js";

export type { GenomeRef, WorktreeEnv, WorktreeOptions } from "./genome-paths.js";
export { cacheRoot } from "./genome-paths.js";
export type { SnapshotHandle } from "./genome-paths.js";
export { snapshotCommit } from "./snapshot.js";
export { INCUMBENT_BRANCH, fastForwardIncumbent } from "./incumbent.js";
export type { FastForwardResult } from "./incumbent.js";

export interface DirtyEntry {
  /** Porcelain v1 2-char status (XY). */
  readonly xy: string;
  /** Repo-relative path (slash-separated, as git reports it). */
  readonly file: string;
}

export interface OpenedGenome {
  readonly repoPath: string;
  readonly headCommit: string;
  /** Currently checked-out branch ("HEAD" when detached). Never mutated by abathur. */
  readonly branch: string;
  /** Unrelated dirtiness notices — todo 9 records these in the ledger as dirty_worktree. */
  readonly dirtyWorktree: readonly DirtyEntry[];
}

export interface GenerationHandle {
  readonly worktreePath: string;
  /** Resolved parent commit sha (the detached HEAD the generation started from). */
  readonly parentCommit: string;
}

export interface SealResult {
  readonly commitSha: string;
  readonly treeSha: string;
}

export interface CleanupReport {
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

const DAY_MS = 86_400_000;
/** Fixed committer identity for sealed generations (repo config is never trusted or touched). */
const SEAL_IDENTITY = ["-c", "user.name=abathur", "-c", "user.email=abathur@harness.local"];

// ------------------------------------------------------------------ openGenome

/** Porcelain v1 with -z: "XY path" records; rename/copy records carry the source as an extra NUL field. */
function parsePorcelain(raw: string): readonly DirtyEntry[] {
  const tokens = raw.split("\0");
  const out: DirtyEntry[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined || token.length < 4) continue;
    const entry: DirtyEntry = { xy: token.slice(0, 2), file: token.slice(3) };
    out.push(entry);
    const kind = entry.xy.charAt(0);
    if (kind === "R" || kind === "C") i += 1; // consume rename/copy source
  }
  return out;
}

function normalizeTarget(repo: string, target: string): string {
  const rel = path.relative(repo, path.resolve(repo, target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    cannotAnswer(`worktree: target path "${target}" is outside the genome repo ${repo}`);
  }
  return rel; // "" === whole repo
}

function isUnder(file: string, target: string): boolean {
  return target === "" || file === target || file.startsWith(`${target}/`);
}

/**
 * Verify the genome repo is a usable worktree base and return dirtiness data.
 * Refusal (blocked, exit 1) happens ONLY when a path under `targetPaths` is
 * dirty (tracked modifications, staged changes, or untracked files); dirtiness
 * elsewhere is returned as `dirtyWorktree` notices for the ledger.
 */
export async function openGenome(
  repoPath: string,
  targetPaths: readonly string[] = [],
  opts: WorktreeOptions = {},
): Promise<OpenedGenome> {
  const repo = path.resolve(repoPath);
  const dirStat = await stat(repo).catch(() => null);
  if (dirStat === null || !dirStat.isDirectory()) {
    blocked(`worktree: genome repo not found at ${repo}`, "clone the genome first");
  }
  const gopts = gitOpts(opts, repo);
  const inside = await tryGit(["rev-parse", "--git-dir"], gopts);
  if (!inside.ok) {
    blocked(`worktree: ${repo} is not a git repository`, inside.error.stderr.trim());
  }
  const bare = await git(["rev-parse", "--is-bare-repository"], gopts);
  if (bare.stdout.trim() === "true") {
    blocked(
      `worktree: ${repo} is a bare repo — genomes must be full working copies (the ledger lives in-tree)`,
    );
  }
  const head = await tryGit(["rev-parse", "HEAD"], gopts);
  if (!head.ok) {
    blocked(`worktree: ${repo} has no commits — seed the genome before opening it`);
  }
  const branchRun = await tryGit(["rev-parse", "--abbrev-ref", "HEAD"], gopts);
  const status = await git(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    gopts,
  );
  const entries = parsePorcelain(status.stdout);
  const targets = targetPaths.map((t) => normalizeTarget(repo, t));
  const underTarget = (e: DirtyEntry): boolean => targets.some((t) => isUnder(e.file, t));
  const dirtyTargets = entries.filter(underTarget);
  if (dirtyTargets.length > 0) {
    blocked(
      `worktree: refusing to open ${repo}: dirty target path(s): ${dirtyTargets
        .map((e) => `${e.xy} ${e.file}`)
        .join(", ")}`,
      "commit or restore them first — abathur never mutates your worktree",
    );
  }
  return {
    repoPath: repo,
    headCommit: head.stdout.trim(),
    branch: branchRun.ok ? branchRun.stdout.trim() : "HEAD",
    dirtyWorktree: entries.filter((e) => !underTarget(e)),
  };
}

// -------------------------------------------------------------- generations

/** `git worktree add --detach <cache>/<genomeFp>/<genId> <parentCommit>`; rev may be a sha or a safe ref name. */
export async function newGeneration(
  genome: GenomeRef,
  parentCommit: string,
  genId: string,
  opts: WorktreeOptions = {},
): Promise<GenerationHandle> {
  const env = opts.env ?? process.env;
  const wt = generationPath(env, genome, genId); // validates both segments (exit 2 on junk)
  const rev = requireRev(parentCommit); // validates before any git spawn
  const repo = path.resolve(genome.repoPath);
  if ((await stat(wt).catch(() => null)) !== null) {
    cannotAnswer(`worktree: generation directory already exists: ${wt}`);
  }
  await mkdir(path.dirname(wt), { recursive: true });
  const added = await tryGit(["worktree", "add", "--detach", wt, rev], gitOpts(opts, repo));
  if (!added.ok) {
    const why = added.error.stderr.trim().split("\n")[0] ?? added.error.message;
    blocked(
      `worktree: cannot create generation ${genId} from ${rev}: ${why}`,
      "is the parent commit reachable in the genome repo?",
    );
  }
  const head = await git(["rev-parse", "HEAD"], gitOpts(opts, wt));
  return { worktreePath: wt, parentCommit: head.stdout.trim() };
}

/** Stage everything inside the generation worktree and commit it; returns commit + tree shas. */
export async function sealGeneration(
  genome: GenomeRef,
  genId: string,
  message: string,
  opts: WorktreeOptions = {},
): Promise<SealResult> {
  const env = opts.env ?? process.env;
  const wt = generationPath(env, genome, genId);
  if ((await stat(wt).catch(() => null)) === null) {
    blocked(
      `worktree: generation ${genId} not found under ${path.dirname(wt)}`,
      "open a generation with newGeneration first",
    );
  }
  const gopts = gitOpts(opts, wt);
  const attached = await tryGit(["symbolic-ref", "-q", "HEAD"], gopts);
  if (attached.ok) {
    blocked(
      `worktree: refusing to seal ${genId} — generations must be detached from branches`,
      "this worktree is on a live branch; abathur never commits there",
    );
  }
  const porcelain = await git(["status", "--porcelain", "--untracked-files=all"], gopts);
  if (porcelain.stdout.length === 0) {
    blocked(`worktree: nothing to seal in generation ${genId} — stage a mutation first`);
  }
  await git(["add", "-A"], gopts);
  // `-m${message}` as ONE argv element: a dash-leading message can never be parsed as an option.
  await git([...SEAL_IDENTITY, "commit", "-q", `-m${message}`], gopts);
  const commitSha = (await git(["rev-parse", "HEAD"], gopts)).stdout.trim();
  const treeSha = (await git(["rev-parse", "HEAD^{tree}"], gopts)).stdout.trim();
  return { commitSha, treeSha };
}

// ------------------------------------------------------------------ cleanup

async function listOrEmpty(dir: string): Promise<readonly string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Remove generation/snapshot dirs older than `olderThanDays` (0 = everything)
 * and prune the repo's dead worktree registry entries. Idempotent: a second
 * run reports nothing. Frozen snapshot dirs are thawed before removal.
 */
export async function cleanupStale(
  genome: GenomeRef,
  olderThanDays: number,
  opts: WorktreeOptions = {},
): Promise<CleanupReport> {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    cannotAnswer("worktree: olderThanDays must be a finite number >= 0");
  }
  const env = opts.env ?? process.env;
  const dir = genomeDir(env, genome); // validates the fingerprint
  const cutoff = Date.now() - olderThanDays * DAY_MS;

  const roots: string[] = [];
  for (const name of await listOrEmpty(dir)) {
    if (name !== SNAPSHOTS_DIR) roots.push(path.join(dir, name));
  }
  const snapRoot = path.join(dir, SNAPSHOTS_DIR);
  for (const name of await listOrEmpty(snapRoot)) {
    roots.push(path.join(snapRoot, name));
  }

  const removed: string[] = [];
  const kept: string[] = [];
  for (const p of roots) {
    const st = await stat(p).catch(() => null);
    if (st === null) continue;
    if (st.mtimeMs <= cutoff) {
      await removeFrozenTree(p);
      removed.push(p);
    } else {
      kept.push(p);
    }
  }
  // Prune AFTER removal: dirs we just deleted leave dead registry entries that
  // would otherwise block re-adding a generation with the same id.
  const pruned = await tryGit(["worktree", "prune"], gitOpts(opts, path.resolve(genome.repoPath)));
  if (!pruned.ok) {
    blocked(
      `worktree: cannot prune the worktree registry of ${genome.repoPath}: ${pruned.error.stderr.trim()}`,
    );
  }
  return { removed, kept };
}
