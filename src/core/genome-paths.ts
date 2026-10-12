// Shared path scheme + input discipline for the generation store (todo 3).
//
//   $XDG_CACHE_HOME/abathur/worktrees/<genomeFp>/<genId>          generation worktrees
//   $XDG_CACHE_HOME/abathur/worktrees/<genomeFp>/snapshots/<sha>  read-only commit copies
//   fallback root when XDG_CACHE_HOME is unset/empty/relative: ~/.cache/abathur/worktrees
//
// All ids arrive as plain strings (todo 2's ids.ts owns their generation — no
// import here). Segments are validated to a conservative charset so a hostile
// or buggy id can never escape the cache dir ("../"), start with "-" (argv
// option injection), or contain shell metacharacters (irrelevant to execFile
// argv, but such paths break every downstream tool that does use a shell).

import path from "node:path";
import os from "node:os";

import { cannotAnswer } from "../exit.js";
import type { GitRunOptions } from "../util/git.js";

/** Env surface for cache-root resolution (injectable for tests). */
export interface WorktreeEnv {
  readonly XDG_CACHE_HOME?: string | undefined;
  readonly HOME?: string | undefined;
}

/** A genome = the upstream repo abathur evolves + its fingerprint. */
export interface GenomeRef {
  readonly repoPath: string;
  readonly genomeFp: string;
}

export interface WorktreeOptions extends GitRunOptions {
  readonly env?: WorktreeEnv | undefined;
}

/** Result of snapshotCommit (type lives with the path scheme it is built from). */
export interface SnapshotHandle {
  readonly snapshotPath: string;
  readonly commitSha: string;
  readonly treeSha: string;
}

/** Reserved child name inside <genomeFp>/ — generation ids may not use it. */
export const SNAPSHOTS_DIR = "snapshots";

/** One safe path segment: alnum start, then [A-Za-z0-9._-] — no "/", no "..", no leading "-". */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** sha/ref spelling a caller may hand to rev-parse/worktree add: alnum start, no leading "-". */
const REV = /^[A-Za-z0-9][A-Za-z0-9._/@{}^~-]*$/;
const HEX_SHA = /^[0-9a-f]{7,64}$/i;

function requireSegment(value: string, what: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    cannotAnswer(
      `worktree: unsafe ${what} "${value}" — expected a single safe path segment`,
      "fingerprints and generation ids come from ids.ts / CLI args; refuse traversal or option-like values",
    );
  }
  return value;
}

/** Validate a commit sha (hex, 7..64) and normalize to lowercase (dir names are content-addressed). */
export function requireSha(value: string, what = "commit sha"): string {
  if (!HEX_SHA.test(value)) {
    cannotAnswer(`worktree: unsafe ${what} "${value}" — expected a hex object id`);
  }
  return value.toLowerCase();
}

/** Validate a revision spelling (sha or simple ref name) safe for argv. */
export function requireRev(value: string): string {
  if (!REV.test(value)) {
    cannotAnswer(
      `worktree: unsafe parent revision "${value}" — expected a sha or plain ref name`,
    );
  }
  return value;
}

function resolveHome(env: WorktreeEnv): string {
  return env.HOME === undefined || env.HOME.length === 0 ? os.homedir() : env.HOME;
}

/** Root for all generation worktrees/snapshots: $XDG_CACHE_HOME/abathur/worktrees else ~/.cache/... */
export function cacheRoot(env: WorktreeEnv = process.env): string {
  const xdg = env.XDG_CACHE_HOME;
  const base =
    xdg !== undefined && xdg.length > 0 && path.isAbsolute(xdg)
      ? xdg
      : path.join(resolveHome(env), ".cache");
  return path.join(base, "abathur", "worktrees");
}

/** <cacheRoot>/<genomeFp> (fingerprint validated). */
export function genomeDir(env: WorktreeEnv, genome: GenomeRef): string {
  return path.join(cacheRoot(env), requireSegment(genome.genomeFp, "genome fingerprint"));
}

/** <cacheRoot>/<genomeFp>/<genId> (both validated; reserved snapshot dir name refused). */
export function generationPath(env: WorktreeEnv, genome: GenomeRef, genId: string): string {
  const id = requireSegment(genId, "generation id");
  if (id === SNAPSHOTS_DIR) {
    cannotAnswer(`worktree: "${SNAPSHOTS_DIR}" is a reserved generation id`);
  }
  return path.join(genomeDir(env, genome), id);
}

/** <cacheRoot>/<genomeFp>/snapshots (fingerprint validated). */
export function snapshotsDir(env: WorktreeEnv, genome: GenomeRef): string {
  return path.join(genomeDir(env, genome), SNAPSHOTS_DIR);
}

/** Narrow WorktreeOptions to GitRunOptions for one cwd (exactOptionalPropertyTypes-friendly). */
export function gitOpts(o: WorktreeOptions, cwd: string): GitRunOptions {
  return {
    cwd,
    ...(o.timeoutMs === undefined ? {} : { timeoutMs: o.timeoutMs }),
    ...(o.bin === undefined ? {} : { bin: o.bin }),
  };
}
